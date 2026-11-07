import { relative, resolve, sep } from 'node:path';
import ts from 'typescript';

export function repoPath(root: string, file: string): string {
    return relative(root, file).split(sep).join('/');
}

export function createConduitResolver(args: { root: string; compilerOptions: ts.CompilerOptions; scopedFiles: readonly string[] }): (fromFile: string, specifier: string) => string | null {
    const absoluteRoot = resolve(args.root);
    const scopedPaths = new Set(args.scopedFiles.map(file => resolve(absoluteRoot, file)));
    return (fromFile, specifier) => {
        if (typeof specifier !== 'string' || specifier.length === 0) {
            return null;
        }
        const containingFile = resolve(absoluteRoot, fromFile);
        const resolved = ts.resolveModuleName(specifier, containingFile, args.compilerOptions, ts.sys).resolvedModule;
        if (!resolved) {
            return null;
        }
        const target = resolve(resolved.resolvedFileName);
        return scopedPaths.has(target) ? repoPath(absoluteRoot, target) : null;
    };
}

export interface ModuleExportTarget {
    exportName: string;
    symbol: ts.Symbol;
    declarationKey: string | null;
    ownerFile: string | null;
}

export function moduleExportTargets(args: { checker: ts.TypeChecker; sourceFile: ts.SourceFile; resolveAlias: (symbol: ts.Symbol) => ts.Symbol; declKeyOf: (symbol: ts.Symbol) => string | null; sourceName?: string | null }): ModuleExportTarget[] {
    const moduleSymbol = args.checker.getSymbolAtLocation(args.sourceFile);
    if (!moduleSymbol) {
        return [];
    }
    const targets: ModuleExportTarget[] = [];
    const sourceName = args.sourceName ?? null;
    for (const exportSymbol of args.checker.getExportsOfModule(moduleSymbol)) {
        if (sourceName === null && exportSymbol.name === 'default') {
            continue;
        }
        if (sourceName !== null && exportSymbol.name !== sourceName) {
            continue;
        }
        const symbol = args.resolveAlias(exportSymbol);
        const declarationKey = args.declKeyOf(symbol);
        const splitAt = declarationKey === null ? -1 : declarationKey.lastIndexOf(':');
        targets.push({
            exportName: exportSymbol.name,
            symbol,
            declarationKey,
            ownerFile: declarationKey === null || splitAt < 0 ? null : declarationKey.slice(0, splitAt)
        });
    }
    return targets;
}

export function collectHeritageDeclarations(
    checker: ts.TypeChecker,
    declaration: ts.ClassDeclaration | ts.InterfaceDeclaration,
    resolveAlias: (symbol: ts.Symbol | undefined) => ts.Symbol | undefined
): Array<{ symbol: ts.Symbol; declaration: ts.ClassDeclaration | ts.InterfaceDeclaration }> {
    const found: Array<{ symbol: ts.Symbol; declaration: ts.ClassDeclaration | ts.InterfaceDeclaration }> = [];
    const seen = new Set<ts.ClassDeclaration | ts.InterfaceDeclaration>();
    const visit = (current: ts.ClassDeclaration | ts.InterfaceDeclaration): void => {
        for (const clause of current.heritageClauses ?? []) {
            for (const heritageType of clause.types) {
                let symbol: ts.Symbol | undefined;
                try {
                    symbol = resolveAlias(checker.getSymbolAtLocation(heritageType.expression));
                } catch {
                    symbol = undefined;
                }
                if (!symbol) {
                    continue;
                }
                for (const base of symbol.declarations ?? []) {
                    if (!ts.isClassDeclaration(base) && !ts.isInterfaceDeclaration(base)) {
                        continue;
                    }
                    if (seen.has(base)) {
                        continue;
                    }
                    seen.add(base);
                    found.push({ symbol, declaration: base });
                    visit(base);
                }
            }
        }
    };
    visit(declaration);
    return found;
}

export function exportInterestNames(rows: ReadonlyArray<{ name?: string; local?: string }>): Set<string> {
    const names = new Set<string>();
    for (const row of rows) {
        if (typeof row.name === 'string' && row.name.length > 0) {
            names.add(row.name);
        }
        if (typeof row.local === 'string' && row.local.length > 0) {
            names.add(row.local);
        }
    }
    return names;
}
