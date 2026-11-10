import test from 'node:test';
import assert from 'node:assert/strict';
import {generateOllama,OllamaError} from '../src/ollama.mjs';
import {config} from '../src/config.mjs';
const base={DATABASE_URL:'postgres://test',JWKS_URL:'https://auth.example/jwks',JWT_ISSUER:'issuer',JWT_AUDIENCE:'gateway',OLLAMA_BASE_URL:'http://ollama:11434',OLLAMA_MODELS:'model:latest'};
test('default disabled and allowlisted',()=>{const c=config(base);assert.equal(c.enabled,false);assert.equal(c.models.has('model:latest'),true)});
test('reject public host without approval',()=>assert.throws(()=>config({...base,OLLAMA_BASE_URL:'http://public.example:11434'})));
test('returns generated content and usage',async()=>{const result=await generateOllama({baseUrl:'http://ollama:11434',model:'test',messages:[{role:'user',content:'hello'}],maxTokens:32,timeoutMs:1000,fetchImpl:async()=>({ok:true,json:async()=>({message:{content:'hi'},prompt_eval_count:2,eval_count:1})})});assert.equal(result.text,'hi')});
test('rejects provider failure without external fallback',async()=>{await assert.rejects(generateOllama({baseUrl:'http://ollama:11434',model:'test',messages:[],maxTokens:32,timeoutMs:1000,fetchImpl:async()=>({ok:false,status:503})}),OllamaError)});
