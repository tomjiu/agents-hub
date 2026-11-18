import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {auditProvenance} from './core/provenance.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const report=await auditProvenance(root);
if(process.argv[2])await fs.writeFile(path.resolve(process.argv[2]),JSON.stringify(report,null,2)+String.fromCharCode(10));
console.log(JSON.stringify({counts:report.counts,exact_content_groups:report.exact_content_groups,warnings:report.warnings,scope:report.scope},null,2));
if(report.warnings.length)process.exitCode=1;
