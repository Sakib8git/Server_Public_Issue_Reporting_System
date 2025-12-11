require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
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
    origin: [process.env.CLIENT_DOMAIN],
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
    const commentsCollection = db.collection("comments");
    const paymentCollection = db.collection("payments");

    // const myReportsCollection = db.collection("my-reports");

    // comments post
    app.post("/comments", verifyJWT, async (req, res) => {
      try {
        const email = req.tokenEmail;
        const commentData = {
          ...req.body,
          email,
          createdAt: new Date(),
        };

        const result = await commentsCollection.insertOne(commentData);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to insert comment", err });
      }
    });
    // all comments
    app.get("/comments", async (req, res) => {
      try {
        const result = await commentsCollection
          .find()
          .sort({ createdAt: -1 })
          .limit(3)
          .toArray();

        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch comments", err });
      }
    });
    // roll of user
    app.get("/user/role/:email", async (req, res) => {
      const email = req.params.email;

      // check citizen (including admin flag)
      const citizen = await citizenCollection.findOne({ email });
      if (citizen) {
        // jodi citizen er document e admin flag thake
        if (citizen.role === "admin") {
          return res.send({ role: "admin" });
        }
        return res.send({ role: "citizen" });
      }

      // check staff
      const staff = await staffCollection.findOne({ email });
      if (staff) {
        return res.send({ role: "staff" });
      }

      // fallback
      res.send({ role: "guest" });
    });
    //! All Issues
    app.get("/reports", async (req, res) => {
      const result = await reportsCollection.find().toArray();
      res.send(result);

      // console.log(result);
    });
    //! Paginated Issues
    // app.get("/reports-paginated", async (req, res) => {
    //   try {
    //     const page = parseInt(req.query.page) || 1;
    //     const limit = parseInt(req.query.limit) || 10;
    //     const skip = (page - 1) * limit;

    //     const issues = await reportsCollection
    //       .find()
    //       .skip(skip)
    //       .limit(limit)
    //       .toArray();

    //     const total = await reportsCollection.countDocuments();

    //     res.send({ issues, total, page, limit });
    //   } catch (err) {
    //     res
    //       .status(500)
    //       .send({ message: "Failed to fetch paginated reports", err });
    //   }
    // });

    app.get("/reports-paginated", async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 8;
        const skip = (page - 1) * limit;

        const { search, status, priority, category } = req.query;

        // ✅ Build query object dynamically
        const query = {};

        // Search by title or location (case-insensitive)
        if (search) {
          query.$or = [
            { title: { $regex: search, $options: "i" } },
            { location: { $regex: search, $options: "i" } },
          ];
        }

        // Filter by status
        if (status) {
          query.status = status;
        }

        // Filter by priority
        if (priority) {
          query.priority = priority;
        }

        // Filter by category
        if (category) {
          query.category = category;
        }

        // ✅ Fetch paginated issues
        const issues = await reportsCollection
          .find(query)
          .skip(skip)
          .limit(limit)
          .toArray();

        const total = await reportsCollection.countDocuments(query);

        res.send({ issues, total, page, limit });
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch reports", err });
      }
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
    // app.get("/reports/pending", async (req, res) => {
    //   try {
    //     const result = await reportsCollection
    //       .find({ status: { $regex: /^pending$/i } })
    //       .sort({ createdAt: -1 })
    //       .limit(6)
    //       .toArray();
    //     res.send(result);
    //   } catch (err) {
    //     res
    //       .status(500)
    //       .send({ message: "Failed to fetch pending issues", err });
    //   }
    // });
    // --------------------------------------------
    //! issue Detaails
    // ! issue Details with staff info

    app.get("/reports/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const cursor = { _id: new ObjectId(id) };

        // find issue
        const issue = await reportsCollection.findOne(cursor);

        if (!issue) {
          return res.status(404).send({ message: "Issue not found" });
        }

        // if issue has assignedStaff, fetch staff details
        if (issue.assignedStaff) {
          const staffInfo = await staffCollection.findOne({
            name: issue.assignedStaff,
          });
          issue.staffInfo = staffInfo; // attach staff details to issue object
        }

        res.send(issue);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch issue details", err });
      }
    });
    // app.get("/reports/:id", async (req, res) => {
    //   const id = req.params.id;
    //   const cursore = { _id: new ObjectId(id) };
    //   const result = await reportsCollection.findOne(cursore);
    //   res.send(result);

    //   // console.log(result);
    // });
    //! reports post---

    app.post("/reports", async (req, res) => {
      try {
        const { reporter } = req.body;

        // citizen info বের করো
        const citizen = await citizenCollection.findOne({
          email: reporter.email,
        });

        if (citizen?.role === "citizen" && citizen?.status === "normal") {
          const issueCount = await reportsCollection.countDocuments({
            "reporter.email": reporter.email,
          });

          if (issueCount >= 3) {
            return res.status(403).send({
              message: "Normal citizens can report a maximum of 3 issues",
              // message: "Please Buy subscription",
            });
          }
        }

        // add createdAt timestamp
        const reportData = { ...req.body, createdAt: new Date() };

        const result = await reportsCollection.insertOne(reportData);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to insert report", err });
      }
    });

    // app.post("/reports", async (req, res) => {
    //   try {
    //     // add createdAt timestamp
    //     const reportData = { ...req.body, createdAt: new Date() };

    //     const result = await reportsCollection.insertOne(reportData);
    //     res.send(result);
    //   } catch (err) {
    //     res.status(500).send({ message: "Failed to insert report", err });
    //   }
    // });
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
    //*note: edit profile
    app.patch("/citizen/:email", verifyJWT, async (req, res) => {
      try {
        const email = req.params.email; // ✅ use param email
        const { name, image } = req.body;

        const result = await citizenCollection.updateOne(
          { email }, // ✅ match by email
          {
            $set: {
              ...(name && { name }),
              ...(image && { image }),
              lastUpdated: new Date(),
            },
          }
        );

        res.send(result);
      } catch (err) {
        res
          .status(500)
          .send({ message: "Failed to update citizen profile", err });
      }
    });
    app.get("/citizen/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const citizen = await citizenCollection.findOne({ email });
        if (!citizen) {
          return res.status(404).send({ message: "Citizen not found" });
        }
        res.send(citizen);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch citizen", err });
      }
    });
    //?note: My issues
    app.get("/dashboard/my-issues", verifyJWT, async (req, res) => {
      const email = req.tokenEmail;
      const result = await reportsCollection
        .find({ "reporter.email": email })
        .toArray();
      res.send(result);

      // console.log(result);
    });
    //*note: edit issue
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
    //note: payment-- for boost
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      // console.log(paymentInfo);
      // res.send(paymentInfo);
      // const amount = Math.floor(paymentInfo?.charge * 100);
      const charge = Number(paymentInfo?.charge) || 0;
      const amount = charge * 100;
      if (amount < 50) {
        return res
          .status(400)
          .send({ error: "Amount must be at least 50 cents" });
      }

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: {
                name: paymentInfo?.name,
                // images: [paymentInfo?.image],
                images: paymentInfo?.image ? [paymentInfo.image] : [],
              },
            },
            quantity: 1,
          },
        ],
        // customer_email: paymentInfo?.email,
        customer_email: paymentInfo?.email || "default@example.com",
        mode: "payment",
        metadata: {
          citizenId: paymentInfo?.citizenId,
          email: paymentInfo?.email,
        },
        success_url: `${process.env.CLIENT_DOMAIN}/boost-pay-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_DOMAIN}/dashboard/cityzen-profile`,
      });

      res.send({ url: session.url });
    });
    // note: make premium
    // update citizen status
    app.patch("/citizen/status/:id", async (req, res) => {
      const id = req.params.id;
      // const { status } = req.body;
      const { status } = req.body;

      try {
        const result = await citizenCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              status,
              paymentDate: new Date(),
            },
          }
        );

        res.send({ success: true, result });
      } catch (err) {
        console.error(err);
        res
          .status(500)
          .send({ success: false, error: "Failed to update status" });
      }
    });
    // -----------------staff-------------
    // GET /reports/assigned/:staffName
    // app.get("/reports/assigned/:staffName", async (req, res) => {
    //   try {
    //     const staffName = req.params.staffName;
    //     const issues = await reportsCollection
    //       .find({ assignedStaff: staffName })
    //       .toArray();
    //     res.send(issues);
    //   } catch (err) {
    //     res
    //       .status(500)
    //       .send({ message: "Failed to fetch assigned issues", err });
    //   }
    // });
    app.get("/reports/assigned/:staffEmail", async (req, res) => {
      try {
        const staffEmail = req.params.staffEmail;
        const issues = await reportsCollection
          .find({ "assignedStaff.email": staffEmail }) // ✅ match by email
          .toArray();
        res.send(issues);
      } catch (err) {
        res
          .status(500)
          .send({ message: "Failed to fetch assigned issues", err });
      }
    });
    // Staff onw a
    app.patch("/staff/self/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const { displayName, photoURL } = req.body;

        const result = await staffCollection.updateOne(
          { email },
          {
            $set: {
              ...(displayName && { name: displayName }),
              ...(photoURL && { photo: photoURL }), // ✅ use "photo" field from DB
              lastUpdated: new Date(),
            },
          }
        );

        res.send(result);
      } catch (err) {
        res
          .status(500)
          .send({ message: "Failed to update staff profile", err });
      }
    });

    // get staff by email
    app.get("/staff/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const staff = await staffCollection.findOne({ email });
        if (!staff) {
          return res.status(404).send({ message: "Staff not found" });
        }
        res.send(staff);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch staff", err });
      }
    });
    // PATCH /reports/:id/status
    app.patch("/reports/:id/status", async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body;

        const result = await reportsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status, statusUpdatedAt: new Date() } }
        );

        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to update status", err });
      }
    });

    //* ---------Admin----------------
    // update profile
    app.patch("/user/:email", verifyJWT, async (req, res) => {
      try {
        const email = req.params.email;
        const { displayName, photoURL } = req.body;

        const result = await citizenCollection.updateOne(
          { email },
          {
            $set: {
              ...(displayName && { name: displayName }),
              ...(photoURL && { image: photoURL }),
              lastUpdated: new Date(),
            },
          }
        );

        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to update user profile", err });
      }
    });
    app.get("/user/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const user = await citizenCollection.findOne({ email });
        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }
        res.send(user);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch user", err });
      }
    });
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
    // app.patch("/staff/:id", async (req, res) => {
    //   try {
    //     const id = req.params.id;
    //     const updateData = req.body; // frontend theke updated staff info asbe

    //     const result = await staffCollection.updateOne(
    //       { _id: new ObjectId(id) }, // filter
    //       { $set: updateData } // update operation
    //     );

    //     res.send(result);
    //   } catch (err) {
    //     res.status(500).send({ message: "Failed to update staff", err });
    //   }
    // });
    // update staff
    app.patch("/staff/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const updateData = req.body;

        const result = await staffCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { ...updateData, updatedAt: new Date() } } // ✅ save update time
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

    // block citizen
    app.patch("/citizen/:id", async (req, res) => {
      const id = req.params.id;
      const { action } = req.body;
      const result = await citizenCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { action } }
      );

      res.send(result);
    });

    // Admin issues
    app.put("/reports/:id/assign", async (req, res) => {
      try {
        const { id } = req.params;
        const { staffEmail, staffName } = req.body; // ✅ send both

        const result = await reportsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              assignedStaff: {
                email: staffEmail, // ✅ stable identifier
                name: staffName, // optional display
              },
              status: "pending",
              assignedAt: new Date(), // ✅ save assign date/time
            },
          }
        );

        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to assign staff", err });
      }
    });

    app.put("/reports/:id/reject", async (req, res) => {
      try {
        const { id } = req.params;

        const result = await reportsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "rejected" } }
        );

        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to reject issue", err });
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
