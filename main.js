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

app.get('/', (req, res) => { // Serve the EJS page
  res.render('index', { history });
});

const availableFunctions = {
  "calculator": (expression) => math.evaluate(expression),
  "search": (query) => {
    const search = new serpapi.GoogleSearch(process.env.SERPAPI_API_KEY);
    return search.json({ q: query });
  }
};

app.post('/ask', async (req, res) => {
  let question = req.body.question;
  let history = [
    {role: 'system', content: 'You are a general purpose AI called Oracle. You will try to answer questions to the best of your ability.'},
    {role: 'user', content: promptTemplate.replace("{question}", question)}
  ];

  let finalAnswer = null;

  while(finalAnswer === null) {
    let response = await axios.post(openaiUrl, {
      model: "gpt-4-0613",
      messages: history,
      functions: [
        {
          "name": "search",
          "description": "Query a search engine",
          "parameters": {
            "type": "object",
            "properties": {
              "query": {
                "type": "string",
                "description": "The search query"
              }
            },
            "required": ["query"]
          }
        },
        {
          "name": "calculator",
          "description": "Calculate the result of a math expression",
          "parameters": {
            "type": "object",
            "properties": {
              "expression": {
                "type": "string",
                "description": "The math expression to calculate"
              }
            },
            "required": ["expression"]
          }
        }
      ]
    }, openaiConfig);

    if (response.data.choices[0].message.function_call) {
      let functionCall = response.data.choices[0].message.function_call;
      let functionName = functionCall.name;
      let functionArguments = JSON.parse(functionCall.arguments);
      if (functionName in availableFunctions) {
        let result = await availableFunctions[functionName](...Object.values(functionArguments));
        history.push({role: 'assistant', content: `Result: ${result}`});
      } else {
        history.push({role: 'assistant', content: 'Thought: I cannot perform the requested action.'});
      }
    } else {
      let content = response.data.choices[0].message.content;
      if (!content.startsWith("Thought: "))
        finalAnswer = content;
      history.push({role: 'assistant', content: content});
    }
  }

  res.render('index', { output: finalAnswer, history });
});

app.listen(3000, () => console.log('Server running on port 3000'));