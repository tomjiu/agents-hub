import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertResolvableSafe,safeFetchUrl} from '../governor.js';
import {loadConfig} from '../config.js';
import {Fetcher} from '../fetcher.js';
import {Cache} from '../cache.js';
const mode={networkMode:'trusted-tun',fakeIpCidrs:['198.18.0.0/15']} as any;
const dns=(...addresses:string[])=>async()=>addresses.map(address=>({address,family:address.includes(':')?6:4}));
test('only trusted TUN mode accepts fake DNS for a public hostname',async()=>{
 const u=new URL('https://official.fixture.net/');
 assert.ok('error' in await assertResolvableSafe(u,{fakeIpCidrs:mode.fakeIpCidrs,lookup:dns('198.18.0.5')} as any));
 const r=await assertResolvableSafe(u,{...mode,lookup:dns('198.18.0.5')});assert.ok(!('error' in r));
});
test('trusted TUN never permits literals local names or real private DNS answers',async()=>{
 for(const host of ['198.18.0.5','127.0.0.1','2130706433','0x7f000001','[::1]','[::ffff:7f00:1]','localhost','foo.localhost','printer.local','metadata.google.internal','intranet']){
  const r=await safeFetchUrl('https://'+host+'/',undefined,{...mode,lookup:dns('198.18.0.5')});assert.ok('error' in r,host);
 }
 for(const ip of ['10.0.0.1','169.254.169.254','192.168.1.1','::ffff:a00:1','fe90::1','198.20.0.1']){
  // Outside fake range public IP is valid, not a fake exemption; private IPv6 must still fail.
  if(ip==='198.20.0.1')continue;
  assert.ok('error' in await assertResolvableSafe(new URL('https://official.fixture.net/'),{...mode,lookup:dns(ip)}),ip);
 }
 assert.ok('error' in await assertResolvableSafe(new URL('https://official.fixture.net/'),{...mode,lookup:dns('198.18.0.5','10.0.0.1')}));
});
test('bad mode or fake CIDRs cannot widen private access',()=>{
 for(const options of [{fetchNetworkMode:'typo'},{fetchNetworkMode:'trusted-tun'},{fetchNetworkMode:'trusted-tun',fakeIpCidrs:['0.0.0.0/0']},{fetchNetworkMode:'trusted-tun',fakeIpCidrs:['192.168.0.0/16']},{fetchNetworkMode:'trusted-tun',fakeIpCidrs:['198.18.0.1/15']},{fetchNetworkMode:'trusted-tun',fakeIpCidrs:['198.18.0.0/33']},{fetchNetworkMode:'trusted-tun',fakeIpCidrs:['198.18.0.0/15'],ssrf:'off'}])assert.throws(()=>loadConfig(options as any),/TUN|network|CIDR|strict/i);
 assert.equal((loadConfig() as any).fetchNetworkMode,'strict');
});
test('TUN fetch retains domain redirect guards and reports its weaker trust boundary',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'sc-tun-')),cache=new Cache(dir);t.after(()=>{cache.close();rmSync(dir,{recursive:true,force:true});});
 const cfg=loadConfig({dataDir:dir,fetchNetworkMode:'trusted-tun',fakeIpCidrs:['198.18.0.0/15']} as any);const calls:string[]=[];
 const fetcher=new (Fetcher as any)(cfg,cache,undefined,async(url:string,init:any)=>{calls.push(url);assert.equal(init.redirect,'manual');return new Response('<html><title>Official</title><article>SQLite WAL concurrency and one writer.</article></html>',{headers:{'content-type':'text/html'}});},dns('198.18.0.5'));
 const r=await fetcher.run('https://official.fixture.net/wal');assert.equal(calls[0],'https://official.fixture.net/wal');assert.equal(r.transport.mode,'trusted-tun');assert.equal(r.transport.remoteIpVerified,false);
 const repeat=await fetcher.run('https://official.fixture.net/wal');assert.equal(repeat.fromCache,true);assert.equal(calls.length,1);
 const redirected=new (Fetcher as any)(cfg,cache,undefined,async()=>new Response(null,{status:302,headers:{location:'https://198.18.0.5/private'}}),dns('198.18.0.5'));
 await assert.rejects(redirected.run('https://official.fixture.net/redirect'),/literal|target|address/i);
});

test('TUN scopes cannot consume strict/legacy cache and strict cannot consume TUN content',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'sc-tun-cache-')),cache=new Cache(dir);t.after(()=>{cache.close();rmSync(dir,{recursive:true,force:true});});
 const url='https://official.fixture.net/wal';cache.putPage(url,200,'text/html','legacy','legacy unsafe cached body');
 let calls=0;const body=async()=>{calls++;return new Response('<html><article>SQLite WAL content from trusted test TUN.</article></html>',{headers:{'content-type':'text/html'}});};
 const cfg=loadConfig({dataDir:dir,fetchNetworkMode:'trusted-tun',fakeIpCidrs:['198.18.0.0/15']});const tun=new Fetcher(cfg,cache,undefined,body,dns('198.18.0.5'));
 assert.equal((await tun.run(url)).fromCache,false);assert.equal(calls,1);assert.equal((await tun.run(url)).fromCache,true);
 const strict=new Fetcher(loadConfig({dataDir:dir}),cache,undefined,body,dns('198.18.0.5'));await assert.rejects(strict.run(url),/private address blocked/);assert.equal(calls,1);
 const narrow=new Fetcher(loadConfig({dataDir:dir,fetchNetworkMode:'trusted-tun',fakeIpCidrs:['198.18.0.0/24']}),cache,undefined,body,dns('198.18.0.5'));assert.equal((await narrow.run(url)).fromCache,false);assert.equal(calls,2);
 assert.equal((await tun.run(url,{}, {globalBlocked:[],allow:['official.fixture.net']})).fromCache,false);assert.equal(calls,3);
 await assert.rejects(tun.run('https://localhost/'),/hostname/);assert.equal(calls,3);
});
test('TUN DNS errors empty answers and out-of-range fake IPs fail closed',async()=>{
 for(const lookup of [dns(),async()=>{throw new Error('dns failure');},dns('198.19.0.5')]){
 const r=await assertResolvableSafe(new URL('https://official.fixture.net/'),{networkMode:'trusted-tun',fakeIpCidrs:['198.18.0.0/24'],lookup});assert.ok('error' in r);
 }
 assert.ok(!('error' in await assertResolvableSafe(new URL('https://official.fixture.net/'),{...mode,lookup:dns('93.184.216.34')})));
});
test('TUN redirects recheck DNS protocol credentials ports and local hosts before second request',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'sc-tun-hop-')),cache=new Cache(dir);t.after(()=>{cache.close();rmSync(dir,{recursive:true,force:true});});const cfg=loadConfig({dataDir:dir,fetchNetworkMode:'trusted-tun',fakeIpCidrs:['198.18.0.0/15']});
 for(const target of ['https://localhost/private','https://127.1/','file:///etc/passwd','https://user:password@public.fixture.net/','https://public.fixture.net:22/','https://private.fixture.net/']){
 let calls=0;const impl=async()=>{calls++;return new Response(null,{status:302,headers:{location:target}});};
 const lookup=async(host:string)=>dns(host==='private.fixture.net'?'10.0.0.1':'198.18.0.5')();const f=new Fetcher(cfg,cache,undefined,impl,lookup);
 await assert.rejects(f.run('https://official.fixture.net/hop'));assert.equal(calls,1,target);
 }
});

test('TUN file configuration is explicit and network environment overrides fail closed',t=>{
 const dir=mkdtempSync(join(tmpdir(),'sc-tun-config-'));const names=['SC_DATA_DIR','SC_FETCH_NETWORK_MODE','SC_FAKE_IP_CIDRS','SC_SSRF'];const prior=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 t.after(()=>{for(const key of names)if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];rmSync(dir,{recursive:true,force:true});});
 process.env.SC_DATA_DIR=dir;delete process.env.SC_FETCH_NETWORK_MODE;delete process.env.SC_FAKE_IP_CIDRS;delete process.env.SC_SSRF;
 writeFileSync(join(dir,'config.json'),JSON.stringify({fetchNetworkMode:'trusted-tun',fakeIpCidrs:['198.18.0.0/15']}));assert.equal(loadConfig().fetchNetworkMode,'trusted-tun');
 process.env.SC_FETCH_NETWORK_MODE='strict';assert.equal(loadConfig().fetchNetworkMode,'strict');
 process.env.SC_FETCH_NETWORK_MODE='typo';assert.throws(()=>loadConfig(),/network mode/);
 process.env.SC_FETCH_NETWORK_MODE='trusted-tun';process.env.SC_FAKE_IP_CIDRS='10.0.0.0/8';assert.throws(()=>loadConfig(),/CIDR/);
 process.env.SC_FAKE_IP_CIDRS='198.18.0.0/15';process.env.SC_SSRF='allowPrivate';assert.throws(()=>loadConfig(),/strict SSRF/);
});
