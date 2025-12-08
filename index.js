require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const port = process.env.PORT || 3000;
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
// middleware
app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:5174"],
    credentials: true,
    optionSuccessStatus: 200,
  })
);
app.use(express.json());

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    console.log(decoded);
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    //! ----------------------------
    const db = client.db("reportHub");
    const reportsCollection = db.collection("reports");
    // const myReportsCollection = db.collection("my-reports");
    //! All Issues
    app.get("/reports", async (req, res) => {
      const result = await reportsCollection.find().toArray();
      res.send(result);

      // console.log(result);
    });
    // Latest Pending Issues (limit 6)
    // Latest Pending Issues (limit 6)
    app.get("/reports/pending", async (req, res) => {
      try {
        const result = await reportsCollection
          .find({ status: { $regex: /^pending$/i } }) // case-insensitive match
          .sort({ createdAt: -1 }) // latest first
          .limit(6)
          .toArray();
        res.send(result);
      } catch (err) {
        res
          .status(500)
          .send({ message: "Failed to fetch pending issues", err });
      }
    });

    //! issue Detaails
    app.get("/reports/:id", async (req, res) => {
      const id = req.params.id;
      const cursore = { _id: new ObjectId(id) };
      const result = await reportsCollection.findOne(cursore);
      res.send(result);

      // console.log(result);
    });
    //! reports post---
    // app.post("/reports", async (req, res) => {
    //   const reportData = req.body;
    //   const result = await reportsCollection.insertOne(reportData);

    //   // await myReportsCollection.insertOne(reportData);

    //   res.send(result);
    // });
    app.post("/reports", async (req, res) => {
      try {
        // add createdAt timestamp
        const reportData = { ...req.body, createdAt: new Date() };

        const result = await reportsCollection.insertOne(reportData);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to insert report", err });
      }
    });

    // citizen Part
    // My issues
    app.get("/dashboard/my-issues", verifyJWT, async (req, res) => {
      const email = req.tokenEmail;
      const result = await reportsCollection
        .find({ "reporter.email": email })
        .toArray();
      res.send(result);

      // console.log(result);
    });
    // Delete issue
    app.delete("/reports/:id", verifyJWT, async (req, res) => {
      try {
        const id = req.params.id;
        const email = req.tokenEmail;

        const result = await reportsCollection.deleteOne({
          _id: new ObjectId(id),
          "reporter.email": email,
        });

        res.send(result); 
      } catch (err) {
        res.status(500).send({ message: "Failed to delete issue", err });
      }
    });

    //* ----------------------------
    //* ----------------------------
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from Server..😊");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
