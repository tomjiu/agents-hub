import {createServer} from 'node:http';
export async function createSearchFixture(){
 const requests=[];
 const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(req.method!=='GET'||url.pathname!=='/search'||url.searchParams.get('format')!=='json'){res.writeHead(404).end();return;}
  const query=url.searchParams.get('q');requests.push({query,format:url.searchParams.get('format')});
  if(query==='fixture invalid'){res.writeHead(200,{'content-type':'text/html'}).end('<html>fixture unavailable</html>');return;}
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({results:[{url:'https://fixture.example/aurora-glacier',title:'Aurora glacier fixture result',content:'DSH-SEARCH-FIXTURE: aurora glacier result delivered by isolated local SearXNG-compatible source',engines:['fixture']}] }));
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {url:'http://127.0.0.1:'+server.address().port,requests,close:async()=>{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}};
}
