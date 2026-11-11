// Adapted from Hong1495/Bee (MIT); see THIRD_PARTY_NOTICES.md.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash,createPublicKey,verify} from 'node:crypto';
const config=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8'));
const root=`release/${config.version}`;
const manifest=JSON.parse(fs.readFileSync(`${root}/latest.json`,'utf8'));
assert.equal(manifest.version,config.version);
assert.deepEqual(Object.keys(manifest.platforms),['darwin-aarch64']);
const platform=manifest.platforms['darwin-aarch64'];
const filename=platform.url.split('/').at(-1);
const bytes=fs.readFileSync(`${root}/${filename}`);
const publicLines=Buffer.from(config.plugins.updater.pubkey,'base64').toString().trim().split('\n');
const publicBytes=Buffer.from(publicLines[1],'base64');
const lines=Buffer.from(platform.signature,'base64').toString().trim().split('\n');
const signature=Buffer.from(lines[1],'base64');
assert.deepEqual(signature.subarray(2,10),publicBytes.subarray(2,10));
const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),publicBytes.subarray(10)]),format:'der',type:'spki'});
const payload=signature.subarray(0,2).toString()==='ED'?createHash('blake2b512').update(bytes).digest():bytes;
assert.ok(verify(null,payload,key,signature.subarray(10)),'archive signature');
const trusted=lines[2].replace(/^trusted comment: /,'');
assert.ok(verify(null,Buffer.concat([signature.subarray(10),Buffer.from(trusted)]),key,Buffer.from(lines[3],'base64')),'trusted comment signature');
const corrupted=Buffer.from(payload);corrupted[0]^=1;assert.equal(verify(null,corrupted,key,signature.subarray(10)),false);
for(const line of fs.readFileSync(`${root}/SHA256SUMS`,'utf8').trim().split('\n')){const[hash,name]=line.split('  ');assert.equal(createHash('sha256').update(fs.readFileSync(`${root}/${name}`)).digest('hex'),hash);}
console.log('PASS: arm64 manifest, updater archive Ed25519 signature, signed comment, tamper rejection and all release checksums');
