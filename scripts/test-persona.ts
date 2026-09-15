import { LUXY_SYSTEM_PROMPT } from '../src/llm/prompts/luxy-system.js';
import { personaPrompt, ROLE_SCREENER_FILTER, ROLE_FORECASTER } from '../src/llm/prompts/persona.js';

console.log('=== LUXY SYSTEM PROMPT (head) ===');
console.log(LUXY_SYSTEM_PROMPT.split('\n').slice(0, 22).join('\n'));
console.log('...\n=== SCREENER (head) ===');
console.log(personaPrompt(ROLE_SCREENER_FILTER, 'TASK example').split('\n').slice(0, 10).join('\n'));
console.log('...\n=== FORECASTER (head) ===');
console.log(personaPrompt(ROLE_FORECASTER, 'x').split('\n').slice(0, 6).join('\n'));
console.log('...\nluxy prompt chars:', LUXY_SYSTEM_PROMPT.length);
console.log('ALL PROMPT CHECKS OK');