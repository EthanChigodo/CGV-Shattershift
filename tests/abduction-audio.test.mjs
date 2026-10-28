import test from 'node:test';
import assert from 'node:assert/strict';
import { Level1Audio } from '../src/audio/level1-audio.js';

class Param {
  value=0; events=[];
  setValueAtTime(v,t){this.value=v;this.events.push([v,t]);}
  linearRampToValueAtTime(v,t){this.value=v;this.events.push([v,t]);}
  cancelAndHoldAtTime(){}
}
class Node {
  gain=new Param();playbackRate=new Param();threshold=new Param();knee=new Param();ratio=new Param();attack=new Param();release=new Param();
  connect(node){return node;} disconnect(){}
}
function harness(){
  const ctx={currentTime:0,destination:new Node(),sources:[],createGain:()=>new Node(),createDynamicsCompressor:()=>new Node(),
    createBufferSource(){
      const node=new Node();node.loop=false;node.stopped=false;
      node.start=(t,offset,duration)=>{node.startAt=t;node.offset=offset;node.duration=duration;node.endAt=t+(duration??node.buffer.duration)/node.playbackRate.value;};
      node.stop=(t=ctx.currentTime)=>{node.stopAt=t;if(t<=ctx.currentTime)end(node);};
      ctx.sources.push(node);return node;
    },
    advance(seconds){this.currentTime+=seconds;for(const n of this.sources)if(!n.stopped&&this.currentTime>=Math.min(n.stopAt??Infinity,n.endAt??Infinity))end(n);}
  };
  function end(n){if(n.stopped)return;n.stopped=true;n.onended?.();}
  const a=new Level1Audio(()=>ctx);a.context=ctx;a._ensureBuses();
  const requested=[];a._load=async name=>{requested.push(name);return {duration:name.startsWith('scream')?3.7:name.startsWith('breath')?2:.45};};
  return {a,ctx,requested};
}

test('grab is an immediate short human scream; capture is louder, non-looping and distance faded',async()=>{
  const {a,ctx}=harness();a.setCharacter('playerMale');
  const grab=await a.playAbductionVoice('grab');
  assert.equal(grab.name,'scream-m');assert.equal(grab.source.startAt,0);assert.equal(grab.source.duration,.85);assert.equal(grab.source.loop,false);
  const grabVolume=a.abductionVoice.volume;
  const capture=await a.playAbductionVoice('capture',{replace:true});
  assert.equal(capture.name,'scream-m');assert.ok(a.abductionVoice.volume>grabVolume);
  assert.ok(grab.source.stopAt<=capture.source.startAt,'replacement fades out before new scream starts');
  a.updateAbductionVoice(10);const near=capture.gain.gain.value;
  a.updateAbductionVoice(40);const middle=capture.gain.gain.value;
  a.updateAbductionVoice(75);assert.ok(near>middle&&middle>capture.gain.gain.value);assert.equal(capture.gain.gain.value,0);
  a.stopAbductionVoice(.18);ctx.advance(.3);assert.equal(a.abductionVoice,null);assert.ok(capture.source.stopped);
});

test('rapid SPACE events cannot stack voices, and efforts vary with increasing intensity',async()=>{
  const {a,ctx}=harness();
  const voices=await Promise.all(Array.from({length:30},()=>a.playAbductionVoice('struggle')));
  assert.equal(voices.filter(Boolean).length,1);assert.equal(ctx.sources.length,1);
  const names=[voices.find(Boolean).name];const quiet=a.abductionVoice.volume;
  ctx.advance(1);
  for(let i=0;i<7;i++){
    const channel=await a.playAbductionVoice('struggle',{intensity:1});
    assert.ok(channel);assert.notEqual(channel.name,names.at(-1));names.push(channel.name);
    assert.ok(a.abductionVoice.volume>quiet);ctx.advance(1);
  }
  assert.ok(new Set(names).size>=2);assert.ok(ctx.sources.every(s=>!s.loop));
  assert.equal(a.gameplayChannels.size,0);
});

test('success replaces struggle with final exertion, and does not stop unrelated falling audio',async()=>{
  const {a,ctx}=harness();const struggle=await a.playAbductionVoice('struggle');
  const escape=await a.playAbductionVoice('escape',{replace:true});
  assert.equal(escape.name,'grunt-f');assert.ok(struggle.source.stopAt<=escape.source.startAt);
  const fall=await a._play('scream-f',{volume:1,cooldown:2});
  a.stopAbductionVoice();ctx.advance(.2);
  assert.ok(escape.source.stopped);assert.equal(fall.source.stopped,false,'fall channel is independent');
});

test('cleanup, pause and mute reject decoded-late voices and stop active abduction playback',async()=>{
  for(const cancel of [a=>a.cleanupLevel(),a=>a.setPaused(true),a=>{a.playerVoice=false;},a=>a.stopAbductionVoice()]){
    const {a,ctx}=harness();let resolve;
    a._load=()=>new Promise(r=>{resolve=r;});
    const request=a.playAbductionVoice('capture');cancel(a);resolve({duration:3.7});
    assert.equal(await request,null);assert.equal(ctx.sources.length,0);assert.equal(a.abductionVoice,null);
  }
  for(const cancel of [a=>a.cleanupLevel(),a=>a.setPaused(true),a=>{a.playerVoice=false;}]){
    const {a,ctx}=harness();const c=await a.playAbductionVoice('capture');cancel(a);ctx.advance(.2);
    assert.ok(c.source.stopped);assert.equal(a.abductionVoice,null);
  }
});

test('rapid state changes while a scream is decoding retain only the newest voice',async()=>{
  const {a,ctx}=harness();let resolve;
  const loading=new Promise(r=>{resolve=r;});a._load=()=>loading;
  const old=a.playAbductionVoice('grab');const next=a.playAbductionVoice('capture',{replace:true});
  resolve({duration:3.7});assert.equal(await old,null);assert.ok(await next);
  assert.equal(ctx.sources.length,1);assert.equal(a.abductionVoice.kind,'capture');
});

test('cleanup between source creation and channel assignment cannot orphan a voice',async()=>{
  const {a,ctx}=harness();const play=a._play.bind(a);
  a._play=async(...args)=>{const channel=await play(...args);a.stopAbductionVoice(0);return channel;};
  assert.equal(await a.playAbductionVoice('capture'),null);assert.ok(ctx.sources[0].stopped);
});

test('voice setting and paused state suppress requests; normal fallScream retains its original options',async()=>{
  const {a,ctx}=harness();a.playerVoice=false;assert.equal(await a.playAbductionVoice('grab'),null);
  a.playerVoice=true;a.setPaused(true);assert.equal(await a.playAbductionVoice('grab'),null);
  assert.equal(ctx.sources.length,0);
  a.setPaused(false);const calls=[];a._play=(...args)=>calls.push(args);a.fallScream();
  assert.deepEqual(calls,[['scream-f',{volume:1,cooldown:2}]]);
});
