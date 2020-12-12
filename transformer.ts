import ts from 'typescript';
import path from 'path';

export default function transformer(program: ts.Program): ts.TransformerFactory<ts.SourceFile> {
  return (context: ts.TransformationContext) => (file: ts.SourceFile) => visitNodeAndChildren(file, program, context);
}

function visitNodeAndChildren(node: ts.SourceFile, program: ts.Program, context: ts.TransformationContext): ts.SourceFile;
function visitNodeAndChildren(node: ts.Node, program: ts.Program, context: ts.TransformationContext): ts.Node | undefined;
function visitNodeAndChildren(node: ts.Node, program: ts.Program, context: ts.TransformationContext): ts.Node | undefined {
  return ts.visitEachChild(visitNode(node, program), childNode => visitNodeAndChildren(childNode, program, context), context);
}

function visitNode(node: ts.SourceFile, program: ts.Program): ts.SourceFile;
function visitNode(node: ts.Node, program: ts.Program): ts.Node | undefined;
function visitNode(node: ts.Node, program: ts.Program): ts.Node | undefined {
  const typeChecker = program.getTypeChecker();
  if (isKeysImportExpression(node)) {
    return;
  }
  else if (isCallExpression(node, typeChecker, 'keys')) {
    if (!node.typeArguments) {
      return ts.createArrayLiteral([]);
    }
    const type = typeChecker.getTypeFromTypeNode(node.typeArguments[0]);
    const properties = typeChecker.getPropertiesOfType(type);
    return ts.createArrayLiteral(properties.map(property => ts.createLiteral(property.name)));
  }
  else if (isCallExpression(node, typeChecker, 'typeMembers')) {
    if (!node.typeArguments) {
      return ts.createObjectLiteral([]);
    }
    const type = typeChecker.getTypeFromTypeNode(node.typeArguments[0]);
    const properties = typeChecker.getPropertiesOfType(type)
      .filter(property => property.declarations && property.declarations.length > 0)
      .map(property => {
        return ts.createPropertyAssignment(
          ts.createIdentifier(property.name),
          ts.createStringLiteral(typeChecker.typeToString(typeChecker.getTypeOfSymbolAtLocation(property, property.declarations[0])))
        )
      });
    return ts.createObjectLiteral(properties);
  } else {
    return node;
  }
}

const indexJs = path.join(__dirname, 'index.js');
function isKeysImportExpression(node: ts.Node): node is ts.ImportDeclaration {
  if (!ts.isImportDeclaration(node)) {
    return false;
  }
  const module = (node.moduleSpecifier as ts.StringLiteral).text;
  try {
    return indexJs === (
      module.startsWith('.')
        ? require.resolve(path.resolve(path.dirname(node.getSourceFile().fileName), module))
        : require.resolve(module)
    );
  } catch(e) {
    return false;
  }
}

const indexTs = path.join(__dirname, 'index.d.ts');
function isCallExpression(node: ts.Node, typeChecker: ts.TypeChecker, functionName: string): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  const declaration = typeChecker.getResolvedSignature(node)?.declaration;
  if (!declaration || ts.isJSDocSignature(declaration) || declaration.name?.getText() !== functionName) {
    return false;
  }
  try {
    // require.resolve is required to resolve symlink.
    // https://github.com/kimamula/ts-transformer-keys/issues/4#issuecomment-643734716
    return require.resolve(declaration.getSourceFile().fileName) === indexTs;
  } catch {
    // declaration.getSourceFile().fileName may not be in Node.js require stack and require.resolve may result in an error.
    // https://github.com/kimamula/ts-transformer-keys/issues/47
    return false;
  }
}
