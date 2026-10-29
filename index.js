import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import 'dotenv/config';
import cors from "cors";
import { createRemoteJWKSet, jwtVerify } from "jose";
const app = express();
const PORT = 8000;

app.use(cors());
app.use(express.json());

// MongoDB Connection start
const client = new MongoClient(process.env.MONGODB_URI);

export async function connectToMongoDB() {
    try {
        await client.connect();
        console.log('You successfully connected to MOngoDB!');
        return client;
    } catch (err) {
        console.dir(err);
    }
};

const mongoClient = await connectToMongoDB();
// Mongodb database Name
const db = mongoClient.db("wanderlust");
const destinationCollection = db.collection("destination");
const bookingCollection = db.collection("bookings")

try {
    await destinationCollection.createIndex(
        { customId: 1 },
        {
            unique: true,
            partialFilterExpression: { customId: { $type: "string" } }
        }
    );
    console.log("destinationCollection unique index on customId is ready");
} catch (err) {
    console.error("Failed to create the unique customId index:", err);
}
// ---------------x-----------------------------------

// Middleware logic
const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).send({ msg: "Unauthorized!" });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).send({ msg: "Unauthorized!" });
    }

    const JWKS = createRemoteJWKSet(new URL(`${process.env.CLIENT_URI}/api/auth / jwks`));

    try {
        const { payload } = await jwtVerify(token, JWKS)
        next();
    } catch {
        return res.status(500).send({ msg: "Server Error" })
    }
}


app.get("/", (req, res) => {
    res.send({ message: "Server is running fine!" })
})

app.get("/destinations", async (req, res) => {
    const result = await destinationCollection.find().toArray();
    res.send(result);
});

app.get("/featured-destination", async (req, res) => {
    const result = await destinationCollection.find().limit(5).toArray();
    res.send(result);
})

app.get(
    "/destination/:id",
    verifyToken,
    async (req, res) => {
        const { id } = req.params;
        const result = await destinationCollection.findOne({ _id: new ObjectId(id) })
        res.send(result);
    })

app.get(
    "/my-bookings/:email",
    verifyToken,
    async (req, res) => {
        const { email } = req.params;
        const result = await bookingCollection.find({ email: email }).toArray();
        res.send(result);
    })

app.delete(
    "/my-bookings/:id",
    verifyToken,
    async (req, res) => {
        const { id } = req.params;
        let query;
        try {
            query = { _id: new ObjectId(id) };
        } catch {
            query = { _id: id };
        }
        let result = await bookingCollection.deleteOne(query);
        if (result.deletedCount === 0) {
            result = await bookingCollection.deleteOne({ _id: id });
        }
        console.log(`DELETE /my-bookings/${id} ->`, JSON.stringify(result));
        res.send(result);
    })

app.patch(
    "/destination/:id",
    verifyToken,
    async (req, res) => {
        const { id } = req.params;
        const updatedData = req.body;
        const result = await destinationCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: updatedData }
        )
        res.json(result);
    });

app.delete("/destination/:id", async (req, res) => {
    const { id } = req.params;
    const result = await destinationCollection.deleteOne({ _id: new ObjectId(id) });
    res.json(result);
})

app.post("/booking", async (req, res) => {
    const data = req.body;
    const result = await bookingCollection.insertOne(data);
    res.send(result);
});

app.post(
    "/add-destination",
    verifyToken,
    async (req, res) => {
        const { customId, ...data } = req.body ?? {};

        if (typeof customId !== "string" || !customId.trim()) {
            return res.status(400).send({ msg: "customId is required" });
        }

        const id = customId.trim();

        // Friendly check first (findOne hits the unique index, so it's fast).
        const existing = await destinationCollection.findOne({ customId: id });
        if (existing) {
            return res
                .status(409)
                .send({ msg: "This destination ID already exists" });
        }

        // Never trust a client-sent _id — Mongo keeps generating its own.
        delete data._id;

        try {
            const result = await destinationCollection.insertOne({
                customId: id,
                ...data
            });
            // A concurrently submitted duplicate surfaces here as code 11000.
            return res.status(201).send(result);
        } catch (err) {
            if (err?.code === 11000) {
                return res
                    .status(409)
                    .send({ msg: "This destination ID already exists" });
            }
            console.error("POST /add-destination failed:", err);
            return res.status(500).send({ msg: "Server Error" });
        }
    })

app.listen(PORT, () => {
    console.log(`Server is running at ${PORT}`);
})