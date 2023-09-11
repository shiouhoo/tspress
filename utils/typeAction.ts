import { SourceFile, InterfaceDeclaration, EnumDeclaration } from 'ts-morph';
import { TypeItem, TypeValue } from '../types';
import { collectDoc } from './collect';
import { cliPath, lineSysbol } from '../global';
import path from 'path';

// 判断字符串是否为基本类型
export const isBaseType = (str: string) => {
    return /^(?:string|number|boolean|undefined|null|symbol)\w?\[\]$/.test(str);
};
/** 通过字符串获取类型 */
export const getTypeByText = (str: string, isDefault): string => {
    if(!Number.isNaN(Number(str))) {
        return 'number';
    }else if(str === 'true' || str === 'false') {
        return 'boolean';
    }else if(str.includes('new')) {
        const match = str.match(/new (.+?)\(/);
        return match[1];
    }else if(str.includes('.')) {
        if(Number.isNaN(Number(str.split('.')[isDefault ? 0 : 1]))) {
            return str.split('.')[isDefault ? 0 : 1];
        }
    }
    return str;
};
/** 解析获取的类型为import() */
export const parseTypeImport = (str: string, sourceFilePath:string) => {
    if((str = str.trim()).includes('import(')) {
        const match = str.match(/import\("(.*?)"\)[.](.+)/)?.map(str => str.trim());
        if(path.join(match[1]).toString() + '.ts' === path.join(sourceFilePath).toString()) {
            return str.replace(`import("${match[1]}").`, '');
        }else{
            return str.replace(cliPath, '');
        }
    }
    return str;
};
/** 对象转字符串 */
export const objectToString = (obj) => {
    if (Array.isArray(obj)) {
        // 如果是数组，递归处理数组元素
        const elements = obj.map(element => objectToString(element));
        return `[${elements.join(',')}]`;
    } else if (typeof obj === 'object' && obj) {
        if (obj instanceof Date) {
            // 如果是 Date 对象，返回日期的字符串表示
            return obj.toISOString();
        } else {
        // 如果是对象，则递归处理其属性
            const keys = Object.keys(obj);
            const pairs = [];

            for (const key of keys) {
                const value = objectToString(obj[key]);
                pairs.push(`${key}:${value}`);
            }

            return `{${pairs.join(',')}}`;
        }
    } else {
        // 如果是基本数据类型或函数，则使用字符串化的值
        return JSON.stringify(obj);
    }
};

/** 将interface，enum的信息转为对象 */
const getDetailByExport = (namedExport:InterfaceDeclaration | EnumDeclaration)=>{
    const typeObject: TypeValue = {};
    if(namedExport instanceof InterfaceDeclaration) {
        for(const member of namedExport.getProperties()) {
            typeObject[member.getName()] = {
                value: member.getTypeNode()?.getText(),
                doc: collectDoc(member.getJsDocs()[0])
            };
        }
    }else if(namedExport instanceof EnumDeclaration) {
        for(const member of namedExport.getMembers()) {
            typeObject[member.getName()] = {
                value: member.getValue() + '',
                doc: collectDoc(member.getJsDocs()[0])
            };
        }
    }
    return Object.keys(typeObject).length ? typeObject : null;
};
/** 将type的信息转为对象 */
export const getDetailTypeByString = (str:string): [TypeValue | string, 'array'|'object'|'string']=>{
    let targetType;
    const typeObject: TypeValue = {};
    if((str = str.trim()).startsWith('Record')) {
        targetType = 'Record';
        const match = str.match(/^Record<\s*([^,]+)\s*,\s*([\s\S]+)>/)?.map(str => str.trim());
        if(match) {
            typeObject[match[1]] = {
                value: match[2],
                doc: null
            };
        }
        return [typeObject, targetType];
    }else if(str.match(/\{([^{}]+)\}\[\]/)) {
        targetType = 'array';
    }else if(str.match(/\{([^{}]+)\}/)) {
        targetType = 'object';
    }else{
        return [str, 'string'];
    }
    // 配置doc和第二行的键值对
    const keyValuePairs = str.match(/(\/\*\*([\s\S]*?)\*\/|\/\/(.*?))?\s*(\w+):\s*([^\n]+)\s*/g);
    for(const pair of keyValuePairs) {
        let [comment, keyValue] = [null, null];
        if(pair.includes('/**') || pair.includes('//')) {
            [comment, keyValue] = pair.split(lineSysbol);
        }else{
            keyValue = pair;
        }
        const [key, value] = keyValue.split(':').map(str => str.replace(/,\s*$/, '').trim());
        typeObject[key] = {
            value: value,
            doc: comment && {
                comment: [[comment.replaceAll('*', '').replaceAll('/', '').trim() || '']]
            }
        };
    }

    return [typeObject, targetType];

};
/** 通过文件以及变量名获取导出的类型信息 */
export const gettypeInfosByExportName = (sourceFile: SourceFile, name:string, isDefault = false): TypeItem=> {

    if(isDefault) {
        // 找到默认导出的类型名，然后使用调用自身找出类型信息
        const defaultExport = sourceFile.getDefaultExportSymbol();
        if (!defaultExport) {
            throw new Error(`${sourceFile.getFilePath()}没有默认导出`);
        }
        // 格式为 import("C:/Users/29729/XX").XX
        const defaultExportType = defaultExport.getDeclaredType().getText();
        const realName = defaultExportType.replace(/import(.*?)[.]/, '').trim();
        return gettypeInfosByExportName(sourceFile, realName, false);
    }else{
        const exportedDeclarations = sourceFile.getExportedDeclarations();
        // 查找具名导出并获取名称,ExportedDeclarations
        let namedExport = null;
        for (const [exportName, declarations] of exportedDeclarations.entries()) {
            if (exportName === name) {
                // 遍历具名导出的声明并获取其名称
                namedExport = declarations[0];
            }
        }
        if (namedExport) {
            const exportText = namedExport.getText();
            if(namedExport instanceof InterfaceDeclaration) {
                return {
                    type: 'interface',
                    value: getDetailByExport(namedExport) || '',
                    docs: collectDoc(namedExport.getJsDocs()[0])
                };
            }else if(namedExport instanceof EnumDeclaration) {
                return {
                    type: 'enum',
                    value: getDetailByExport(namedExport) || '',
                    docs: collectDoc(namedExport.getJsDocs()[0])
                };
            }if(exportText.includes('type')) {
                return {
                    type: 'type',
                    value: exportText.split('=')[1]?.replace(';', '')?.trim(),
                    docs: collectDoc(namedExport.getJsDocs()[0])
                };
            }else{
                return {
                    type: '未知',
                    value: '没有解析到类型，可能来源于第三方包',
                    docs: null
                };
            }
        } else {
            throw new Error(`${sourceFile.getFilePath()}没有导出${name}`);
        }
    }
};