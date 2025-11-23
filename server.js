import express from "express"
import { generate } from "./chatbot.js"
import cors from 'cors'
const app = express()
app.use(cors());
const port = 3001

app.use(cors({
    origin: ['http://127.0.0.1:5500', 'http://localhost:5500'],
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
  }));
app.use(express.json())

app.get('/', (req, res) => {
  res.send("Welcome to chatbot ai.")
})

app.post('/chat', async(req,res)=>{
    const {message, threadId} = req.body;
    // validation
    if(!message || !threadId){
        res.status(400).json({message: 'All fields are required'});
        return;
    }
    console.log("Message is ",message);
    const result = await generate(message, threadId)
    console.log("RESULT is =>",result)
    res.json({message: result})
})

app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})
