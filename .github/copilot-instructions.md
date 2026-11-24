This is a DeepSpace app. Use DeepSpace platform primitives instead of 
writing your own auth, data, or realtime. Follow the patterns in 
src/schemas/items-schema.ts and src/pages/(app)/(protected)/items.tsx.
Never hard-code secrets. When calling anthropic/chat-completion, always 
pass model "claude-haiku-5-5" and max_tokens 500 (the default model is 
expensive).