import test from 'node:test';
import assert from 'node:assert/strict';
import {createSearchFixture} from '../search-fixture.mjs';
test('isolated search fixture validates route and returns deterministic success/failure',async()=>{
 const fixture=await createSearchFixture();try{
  const bad=await fetch(fixture.url+'/not-search');assert.equal(bad.status,404);
  const good=await fetch(fixture.url+'/search?format=json&q=aurora%20glacier');const data=await good.json();assert.equal(data.results.length,1);assert.match(data.results[0].content,/DSH-SEARCH-FIXTURE/);assert.equal(fixture.requests[0].query,'aurora glacier');
  const failed=await fetch(fixture.url+'/search?format=json&q=fixture%20invalid');assert.match(await failed.text(),/unavailable/);assert.equal(fixture.requests.length,2);
 }finally{await fixture.close();}
});
