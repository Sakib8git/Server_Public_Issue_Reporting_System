// const fs = require('fs')
// const jsonData = fs.readFileSync('./serviceAccountKey.json')

// const base64String = Buffer.from(jsonData, 'utf-8').toString('base64')
// console.log(base64String)

const fs = require('fs');
const key = fs.readFileSync('./serviceAccountKey.json', 'utf8')
const base64 = Buffer.from(key).toString('base64')
console.log(base64)