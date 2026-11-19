import fs from 'node:fs/promises';
import {confined} from './files.mjs';
export function declaredRestriction(text){
 return typeof text==='string'&&text.includes('ADDITIONAL RESTRICTIONS')&&text.includes('users may not')&&(text.includes('Distribute, sublicense, or transfer')||text.includes('Reproduce or copy these materials'));
}
export async function assertDeployableLicense(asset,source){
 if(asset.source?.license_status==='restricted-declared'||asset.source?.redistribution_review_required===true)throw new Error('Declared license restriction blocks deployment: '+asset.id+'; inspect original license and resolve separately');
 // Read the effective version too; removing a metadata flag must not suppress original restrictions.
 try{const text=await fs.readFile(await confined(source,'LICENSE.txt'),'utf8');if(declaredRestriction(text))throw new Error('Declared license restriction blocks deployment: '+asset.id+'; preserved source is not deployment approval');}
 catch(e){if(e.code!=='ENOENT')throw e;}
}
