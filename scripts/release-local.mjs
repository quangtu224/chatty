import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';

// Private local tests gate every release; CI cannot run files kept out of Git.
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const sha=git('rev-parse','HEAD');
assert.match(sha,/^[a-f0-9]{40}$/);
const clean=()=>assert.equal(git('status','--porcelain'),'','Commit source changes before releasing.');
clean();
assert.ok(process.env.npm_execpath,'Run this through npm run release:local.');
const run=(command,args)=>{
  const result=spawnSync(command,args,{stdio:'inherit',env:{...process.env,RELEASE_SHA:sha}});
  if(result.error || result.status!==0)throw new Error('Release stopped: a required command failed.');
};
run(process.execPath,[process.env.npm_execpath,'run','verify']);
clean();assert.equal(git('rev-parse','HEAD'),sha,'HEAD changed during verification.');
run('docker',['compose','build','app']);
clean();assert.equal(git('rev-parse','HEAD'),sha,'Source changed while building the image.');
// Dependencies run migrations/grants before app start; a failure prevents this revision starting.
run('docker',['compose','up','-d','--wait','--wait-timeout','60','app']);
run(process.execPath,['scripts/smoke.mjs',`http://127.0.0.1:${process.env.APP_PORT ?? 3000}`,sha]);
console.log(`Local release verified: ${sha}. Retain this image for rollback.`);
