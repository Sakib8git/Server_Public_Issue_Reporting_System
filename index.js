require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const admin = require("firebase-admin");
const { default: Stripe } = require("stripe");
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
    const citizenCollection = db.collection("citizen");
    const reportsCollection = db.collection("reports");
    const staffCollection = db.collection("staff");
    // const myReportsCollection = db.collection("my-reports");
    //! All Issues
    app.get("/reports", async (req, res) => {
      const result = await reportsCollection.find().toArray();
      res.send(result);

      // console.log(result);
    });

    //! All citizen
    app.get("/citizen", async (req, res) => {
      const result = await citizenCollection.find().toArray();
      res.send(result);

      // console.log(result);
    });

    // create citizen
    app.post("/citizen", async (req, res) => {
      try {
        // add createdAt timestamp + role
        const citizenData = {
          ...req.body,
          role: "citizen",
          createdAt: new Date(),
        };

        const result = await citizenCollection.insertOne(citizenData);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to insert citizen", err });
      }
    });

    //fixme: Latest Pending Issues (limit 6)
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
    // --------------------------------------------
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
    //! upvote count
    app.patch("/reports/:id/upvote", verifyJWT, async (req, res) => {
      try {
        const id = req.params.id;
        const email = req.tokenEmail;

        // Find issue
        const issue = await reportsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!issue) {
          return res.status(404).send({ message: "Issue not found" });
        }

        // ❌ Prevent self-upvote
        if (issue.reporter?.email === email) {
          return res
            .status(403)
            .send({ message: "You cannot upvote your own issue" });
        }

        // ❌ Prevent duplicate upvote
        if (issue.upvoters && issue.upvoters.includes(email)) {
          return res
            .status(400)
            .send({ message: "You have already upvoted this issue" });
        }

        // ✅ Update: increment upvote + add user email
        const result = await reportsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $inc: { upvote: 1 },
            $push: { upvoters: email },
          }
        );

        res.send({ message: "Upvote successful", result });
      } catch (err) {
        res.status(500).send({ message: "Failed to upvote issue", err });
      }
    });
    //  ----------------------------citizen---------------------------------
    //?note: My issues
    app.get("/dashboard/my-issues", verifyJWT, async (req, res) => {
      const email = req.tokenEmail;
      const result = await reportsCollection
        .find({ "reporter.email": email })
        .toArray();
      res.send(result);

      // console.log(result);
    });
    //*note: edit
    app.patch("/reports/:id", verifyJWT, async (req, res) => {
      try {
        const id = req.params.id;
        const email = req.tokenEmail;
        const updateData = req.body;

        const result = await reportsCollection.updateOne(
          {
            _id: new ObjectId(id),
            "reporter.email": email,
            status: "Pending", // still only editable if Pending
          },
          {
            $set: {
              ...updateData,
              lastUpdated: new Date(), // ✅ add/update timestamp
            },
          }
        );

        // No 403 check, just send result back
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to update issue", err });
      }
    });
    //!note: Delete issue
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
    //Todo: payment-- for boost
    // app.post("/create-checkout-session", verifyJWT, async (req, res) => {
    //   try {
    //     const paymentInfo = req.body;
    //     const issueId = paymentInfo.issueId;
    //     const amount = 100 * 100; // 100 Taka → Stripe expects smallest unit (paisa/cents)

    //     // Create Stripe Checkout Session
    //     const session = await stripe.checkout.sessions.create({
    //       line_items: [
    //         {
    //           price_data: {
    //             currency: "usd", // Stripe does not support BDT directly, so use USD or test currency
    //             unit_amount: amount,
    //             product_data: {
    //               name: "Boost Issue Priority",
    //               description: `Boosting issue: ${paymentInfo?.title}`,
    //               images: [paymentInfo?.image],
    //             },
    //           },
    //           quantity: 1,
    //         },
    //       ],
    //       // ✅ Use reporter email instead of customer
    //       customer_email: paymentInfo.reporter.email,
    //       mode: "payment",
    //       metadata: {
    //         issueId: issueId,
    //         reporter: paymentInfo.reporter.email, // ✅ store reporter email in metadata
    //       },
    //       success_url: `${process.env.CLIENT_DOMAIN}/paymentSuccess?session_id={CHECKOUT_SESSION_ID}`,
    //       cancel_url: `${process.env.CLIENT_DOMAIN}/issue-details/${issueId}`,
    //     });

    //     res.json({ id: session.id });
    //   } catch (err) {
    //     console.error("Stripe Checkout Error:", err);
    //     res
    //       .status(500)
    //       .send({ message: "Failed to create checkout session", err });
    //   }
    // });

    //* ---------Admin----------------
    // add staff
    app.post("/staff", async (req, res) => {
      try {
        // add createdAt timestamp
        const staffData = { ...req.body, createdAt: new Date() };

        const result = await staffCollection.insertOne(staffData);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to insert report", err });
      }
    });
    // get all staff
    app.get("/staff", async (req, res) => {
      try {
        const staff = await staffCollection.find().toArray();
        res.send(staff);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch staff", err });
      }
    });

    // update staff
    app.patch("/staff/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const updateData = req.body; // frontend theke updated staff info asbe

        const result = await staffCollection.updateOne(
          { _id: new ObjectId(id) }, // filter
          { $set: updateData } // update operation
        );

        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to update staff", err });
      }
    });
    // delete
    app.delete("/staff/:id", verifyJWT, async (req, res) => {
      try {
        const id = req.params.id;
        // const email = req.tokenEmail;

        const result = await staffCollection.deleteOne({
          _id: new ObjectId(id),
          // "reporter.email": email,
        });

        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to delete issue", err });
      }
    });

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
