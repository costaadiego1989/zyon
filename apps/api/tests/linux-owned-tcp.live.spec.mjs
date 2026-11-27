import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer,connect} from 'node:net';
import {once} from 'node:events';
import {readOwnedLinuxTcpRows} from './linux-owned-tcp.mjs';

test('Linux native ownership is corroborated by actual current-process sockets and /proc',async()=>{
  assert.equal(process.platform,'linux');const peers=new Set(),server=createServer(socket=>{peers.add(socket);socket.once('close',()=>peers.delete(socket));});let client;
  try{
    server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;
    client=connect({host:'127.0.0.1',port});await once(client,'connect');const local=client.address();
    const rows=await readOwnedLinuxTcpRows();
    assert.deepEqual(rows.filter(row=>row.LocalAddress==='127.0.0.1'&&row.LocalPort===local.port),[
      {LocalAddress:'127.0.0.1',LocalPort:local.port,RemoteAddress:'127.0.0.1',RemotePort:port,OwningProcess:process.pid,State:'Established'}]);
  }finally{
    const closures=[...peers].map(socket=>once(socket,'close'));if(client&&!client.closed)closures.push(once(client,'close'));
    client?.destroy();for(const peer of peers)peer.destroy();await Promise.all(closures);
    if(server.listening)await new Promise((yes,no)=>server.close(error=>error?no(error):yes()));
    assert.equal(peers.size,0);assert.equal(server.listening,false);
  }
});
