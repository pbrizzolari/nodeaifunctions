const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const math = require('mathjs');
const serpapi = require('google-search-results-nodejs');
const dotenv = require('dotenv');
dotenv.config();

let promptTemplate = `Answer the following questions as best you can. You have access to the following tools:

search: a search engine. useful for when you need to answer questions about current
        events. input should be a search query.
calculator: useful for getting the result of a math expression. The input to this
            tool should be a valid mathematical expression that could be executed
            by a simple calculator.

Use the following format:

Question: the input question you must answer
Thought: you should always think about what to do
Action: the action to take, should be one of [search, calculator]
Action Input: the input to the action
Observation: the result of the action
... (this Thought/Action/Action Input/Observation can repeat 10 times)
Thought: I now know the final answer
Final Answer: the final answer to the original input question

Begin!

Question: {question}
Thought:`

axios.interceptors.request.use(x => {

    const headers = {
        ...x.headers.common,
        ...x.headers[x.method],
        ...x.headers
    };

    ['common','get', 'post', 'head', 'put', 'patch', 'delete'].forEach(header => {
        delete headers[header]
    })

    const printable = `${new Date()} | Request: ${x.method.toUpperCase()} | ${x.url} | ${ JSON.stringify( x.data) } | ${ JSON.stringify(headers)}`
    console.log(printable)

    return x;
})


axios.interceptors.response.use(x => {

    const printable = `${new Date()} | Response: ${x.status} | ${ JSON.stringify(x.data) }`
    console.log(printable)

    return x;
})

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.set('view engine', 'ejs'); // Set EJS as the view engine

//SerAPI
let serp = new serpapi.GoogleSearch(process.env.SERPAPI_API_KEY);
// OpenAI API configuration
const openaiApiKey = process.env.OPENAI_API_KEY;
const openaiUrl = 'https://api.openai.com/v1/chat/completions';
const openaiConfig = {
  headers: {
    'Authorization': `Bearer ${openaiApiKey}`,
    'Content-Type': 'application/json'
  }
};

let history = [];

// Available functions for the AI
const availableFunctions = {
  'calculator': (input) => math.evaluate(input),
  'search': async (query) => {
    const data = await serp.json({
      q: query
    });
    return data.organic_results.map(result => result.title).join(', ');
  }
};

app.get('/', (req, res) => { // Serve the EJS page
  res.render('index', { history });
});

app.post('/ask', async (req, res) => {
  const { question } = req.body;
  history.push({role: 'user', content: promptTemplate.replace("{question}", question)});

  let finalAnswer = null;
  let output = '';

  while(finalAnswer === null) {
    // Send the question to OpenAI
    let response = await axios.post(openaiUrl, { model: "gpt-4-0613", messages: history }, openaiConfig);
    output = response.data.choices[0].message.content;

    // Parse the output to get the action and action input
    let lines = output.split('\n');
    for(let i = 0; i < lines.length; i += 2) {
      if(lines[i].startsWith('Action: ')) {
        let action = lines[i].replace('Action: ', '');
        let actionInput = lines[i+1].replace('Action Input: ', '');
        console.log(action);
        console.log(actionInput);
        if(action in availableFunctions) {
          let observation = await availableFunctions[action](actionInput);
          history.push({role: 'assistant', content: `Observation: ${observation}`});
        } else {
          history.push({role: 'assistant', content: 'Thought: I cannot perform the requested action.'});
          break;
        }
      } else if(lines[i].startsWith('Final Answer: ')) {
        finalAnswer = lines[i].replace('Final Answer: ', '');
        history.push({role: 'assistant', content: `Final Answer: ${finalAnswer}`});
        break;
      } else {
          finalAnswer = output;
        history.push({role: 'assistant', content: output});
        break;
      }
    }
  }

  // Render the EJS page with the output
  res.render('index', { output: finalAnswer || output, history });
});

app.listen(3000, () => console.log('Server running on port 3000'));