import express = require('express');
import zod = require('zod');
import { Output , streamText} from 'ai';
import { groq } from '@ai-sdk/groq';
import {tavily} from '@tavily/core';
import {PROMPT_TEMPLATE,SYSTEM_PROMPT} from './prompt';
import cors = require('cors');
import bodyParser = require('body-parser');
import { json } from 'zod/v4/mini';
import { Schema } from 'zod/v3';
const client = tavily({
    apiKey: process.env.TAVILY_API_KEY || '',
})


const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = 3000;

app.get('/',(req,res)=>{
    res.send('Hello from singh server !!');
})

app.post('/signup',async(req,res)=>{

})
app.post('/login',async(req,res)=>{

})

app.get('/conversations',async(req,res)=>{

})


app.post('/conversation/:conversationId',async(req,res)=>{

})



app.post("/aibuddy_ask", async (req,res)=>{

//  step - 1 get the query from the user
 const query = req.body.query;


//  step - 2 make sure user has access/credits to hit the endpoint
//  step - 3 (todo) - check if we have web search indexed for a similar query
//  step - 4 web search to gather resources
const webSearchResponse = await client.search(query,{
  searchDepth:"advanced"
})

const webSearchResults = webSearchResponse.results;

//  step - 5 do some context engineering on the prompt + web search responses
//  step - 6 hit the LLM and stream back the response

const prompt = PROMPT_TEMPLATE
.replace("{{WEB_SEARCH_RESULTS}}",JSON.stringify(webSearchResults))
.replace("{{USER_QUERY}}",query);

const result = streamText({
    model: groq('llama-3.1-8b-instant'),
    prompt: prompt,
    system: SYSTEM_PROMPT,
});

    res.header('Cache-Control', 'no-cache');
    res.header('Content-Type', 'text/event-stream');
    for await (const testPart of result.textStream){
    res.write(testPart);
}
res.write("\n<SOURCES>\n");

//  step - 7 also stream back the sources and follow up the conversation with the user (which we can get fromanother parallel LLm call )
res.write(JSON.stringify(webSearchResults.map((result)=>({url:result.url}))));

res.write("\n<SOURCES>\n"); 

// close th event stream
res.end();
});

app.post('/aibuddy_ask/followup',async (req,res)=>{
    
});



 
app.listen(PORT,()=>{
    console.log(`Server is running on port ${PORT}`);
});