import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer as createViteServer } from "vite";
import { configureProxyCleanup } from "../dev/proxyCleanup";

const upstream = createHttpServer((req,res) => {
  if(req.url === "/api/events") {
    res.writeHead(200,{"Content-Type":"text/event-stream","Cache-Control":"no-cache"});
    res.flushHeaders();
    res.write("event: ready\ndata: {}\n\n");
    setTimeout(()=>res.socket?.destroy(),50);
  } else if(req.url === "/api/before-headers") res.socket?.destroy();
  else { res.setHeader("Content-Type","application/json");res.end(JSON.stringify({ok:true})); }
});
await new Promise<void>(resolve=>upstream.listen(0,"127.0.0.1",resolve));
const target=`http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
const proxy = await createViteServer({configFile:false,logLevel:"silent",server:{host:"127.0.0.1",port:0,strictPort:true,proxy:{"/api":{target,configure:configureProxyCleanup}}}});
try {
  await proxy.listen();
  const base=`http://127.0.0.1:${(proxy.httpServer!.address() as AddressInfo).port}`;
  const stream=await fetch(base+"/api/events",{signal:AbortSignal.timeout(2000)});
  assert.equal(stream.status,200);
  assert.ok((await stream.text()).includes("event: ready"));
  assert.deepEqual(await (await fetch(base+"/api/health",{signal:AbortSignal.timeout(2000)})).json(),{ok:true});
  const failure=await fetch(base+"/api/before-headers",{signal:AbortSignal.timeout(2000)});
  assert.equal(failure.status,500);
  await failure.text();
  console.log("PASS: interrupted SSE closes; subsequent requests succeed; pre-header error remains 500");
} finally {
  await proxy.close();
  upstream.closeAllConnections();
  await new Promise<void>(resolve=>upstream.close(()=>resolve()));
}
