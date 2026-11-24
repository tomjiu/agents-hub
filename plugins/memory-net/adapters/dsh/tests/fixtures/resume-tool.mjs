import fs from 'node:fs'
export const name='mn-resume-fixture'
export const inject=['tools']
export function apply(ctx) {
 ctx.tools.register({name:'mn_resume_echo',description:'Fixture tool whose result is auto-observed into session memory',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object',properties:{echoed:{type:'string'}},required:['echoed'],additionalProperties:false},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]},execute:()=>({echoed:'AUTO-RESUME-OBS-1 done'})})
}
