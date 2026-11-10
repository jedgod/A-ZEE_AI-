import test from 'node:test';import assert from 'node:assert/strict';import {generateOllama} from '../src/ollama.mjs';
test('Ollama adapter sends a private non-streaming chat and parses usage',async()=>{
 const x=await generateOllama({baseUrl:'http://ollama:11434',model:'qwen2.5:0.5b',messages:[{role:'user',content:'hello'}],maxTokens:20,timeoutMs:2000,fetchImpl:async(url,options)=>{
  assert.equal(url,'http://ollama:11434/api/chat');assert.equal(JSON.parse(options.body).stream,false);
  return {ok:true,json:async()=>({message:{content:'hi'},prompt_eval_count:4,eval_count:2})};
 }});
 assert.deepEqual(x,{text:'hi',inputTokens:4,outputTokens:2});
});
