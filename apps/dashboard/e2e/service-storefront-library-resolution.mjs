import assert from 'node:assert/strict';
import {isAbsolute,relative,resolve,sep} from 'node:path';

/** The fixture imports real Storefront components into the dashboard Vite
 * server. Resolve only their own Next-style lib imports; every dashboard and
 * unrelated alias remains delegated to its existing resolver. */
export function createStorefrontScopedLibraryPlugin(storefrontSource){
  assert.ok(isAbsolute(storefrontSource),'service_storefront_source_absolute_required');
  const sourceRoot=resolve(storefrontSource),libraryRoot=resolve(sourceRoot,'lib');
  return {name:'service-storefront-scoped-library',enforce:'pre',
    async resolveId(id,importer,options){
      if(typeof id!=='string'||!id.startsWith('@/lib/')||typeof importer!=='string'||importer.includes('\0'))return null;
      let file=importer.split(/[?#]/,1)[0];
      if(file.startsWith('/@fs/'))file=file.slice(5);
      if(!isAbsolute(file))return null;
      const scope=relative(sourceRoot,file);
      if(!scope||isAbsolute(scope)||scope==='..'||scope.startsWith('..'+sep))return null;
      const target=resolve(sourceRoot,id.slice(2)),withinLibrary=relative(libraryRoot,target);
      if(!withinLibrary||isAbsolute(withinLibrary)||withinLibrary==='..'||withinLibrary.startsWith('..'+sep))return null;
      return this.resolve(target,importer,{...options,skipSelf:true});
    }};
}
