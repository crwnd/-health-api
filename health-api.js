"use strict";
import express from 'express';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import jsonwebtoken from "jsonwebtoken";
import cookieParser from "cookie-parser";
import compression from "compression";
import * as dotenv from "dotenv";
dotenv.config({
    path: ".env",
});
import { exec } from "child_process";

const httpPort = 4000;
let cookieMaxAge = 1000 * 60 * 60 * 24 * 180; // 180 days since last visit
import bodyParser from "body-parser";

const app = express();
app.use(
    bodyParser.urlencoded({
        extended: true,
    })
);

const StravaCreds = { client_id: "0", client_secret: "xxx" }

function os_func() {
    this.execCommand = function (cmd) {
        return new Promise((resolve, reject) => {
            exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(stdout);
            });
        });
    };
}
let os = new os_func();

app.use(cookieParser());
app.use(compression());
// app.use(cors({
//     origin: true 
// }));
app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', req.get('origin') || '*');
    res.setHeader("Access-Control-Allow-Credentials", "true");
    next();
});

console.log("connecting to mongodb...");
mongoose.connect(process.env.MONGO_LINK, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    dbName: "Health"
});
const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error: "));
db.once("open", function () {
    console.log("Connected successfully");
});
function getMiddlePoint(coordinates) {
    if (coordinates.length == 0) {
        return [23.106111, 53.5775];
    }
    if (coordinates.length == 1) {
        return coordinates[0];
    }
    let sumX = 0;
    let sumY = 0;

    // Calculate the sum of all X and Y coordinates
    coordinates.forEach((coord) => {
        sumX += coord[0];
        sumY += coord[1];
    });

    // Calculate the average X and Y coordinates
    const avgX = sumX / coordinates.length;
    const avgY = sumY / coordinates.length;

    // Return the middle point as an array
    return [avgX, avgY];
}
const Schema = mongoose.Schema;

export let userSchema = new Schema({
    id: {
        type: Number,
        required: true,
    },
    name: {
        type: String,
        trim: true,
    },
    lastActive: {
        type: Number,
        default: Math.floor(Date.now() / 1000),
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
    },
    password: {
        type: String,
        required: true,
    },
    sessions: [Object],
    addresses: [{
        type: String,
        main: Boolean,
        required: false,
        trim: true,
        min: 5,
        max: 200,
    },],
    avatar: {
        type: String,
        required: false,
        default: "/static/user-avatars/person.png",
    },
    publicProfile: {
        type: Boolean,
        default: true,
    },
    admin: {
        type: Boolean,
        default: false,
    },
    created: {
        type: Number,
        default: Math.floor(Date.now() / 1000),
    },
    deleted: {
        type: Boolean,
        default: false,
    },
    strava: Object
});

let challengesSchema = new Schema({
    id: {
        type: Number,
        required: true,
        unique: true,
    },
    created: {
        type: Number,
        default: Math.floor(Date.now() / 1000),
    },
    ctype: {
        type: String,
        required: true,
    },
    deleted: {
        type: Boolean,
        required: true,
        default: false,
    },
    participants: [],
    starts: Number,
    longs: Number,
    coordinates: [],
    participantsData: Object,
    owner: Number,
    image: String,
    image_square: String,
    cname: String,
    cdesc: String,
    deleted: Boolean,
    distance: Number,
    sport_type: String,
});

let UsersModel = mongoose.model("users", userSchema);
let challengesModel = mongoose.model("challenges", challengesSchema);

app.post("/users/getme/", forceAuthenticateToken, async (req, res) => {
    let user = await UsersModel.findOne({
        id: req.user.id,
    });

    try {
        if (user.sessions.find(el => el.id == req.user.i).isActive != true) {
            return res.status(200).json({
                code: 1,
                message: "session-expired",
            });
        }
    } catch (e) {
        console.log("session expire check error", e);
        return res.status(200).json({
            code: 1,
            message: "session-expired",
        });
    }

    let isStravaLinked = false;

    try {
        isStravaLinked = user.strava.refresh_token.length > 1;
    } catch (e) { }

    return res.status(200).json({
        code: 0,
        message: "success",
        name: user.name,
        id: user.id,
        email: user.email,
        sessions: user.sessions,
        has_strava_token: isStravaLinked,
        participated: await challengesModel.find({ participants: req.user.id }) || [],
        admin: user.admin,
        currentSessionID: req.user.i,
        avatar: user.avatar,
    });
});

app.get("/api/strava-link/", forceAuthenticateToken, async (req, res) => {
    let user = await UsersModel.findOne({
        id: req.user.id,
    });

    try {
        if (user.sessions.find(el => el.id == req.user.i).isActive !== true) {
            return res.status(200).json({
                code: 1,
                message: "session-expired",
            });
        }
    } catch (e) {
        return res.status(200).json({
            code: 1,
            message: "session-expired",
        });
    }

    try {
        console.log("requesting strava...");
        let resp = await (await fetch("https://www.strava.com/oauth/token?client_id=" + StravaCreds.client_id + "&client_secret=" + StravaCreds.client_secret + "&code=" + req.query.code + "&grant_type=authorization_code", {
            method: "POST",
            redirect: 'follow'
        })).json();
        console.log("resp", resp);
        console.log("db...");
        try {
            await UsersModel.updateOne({
                id: req.user.id,
            }, {
                "strava.refresh_token": resp.refresh_token,
                "strava.access_token": resp.access_token,
                "strava.expires_at": parseInt(resp.expires_at),
                "strava.athlete": resp.athlete
            });
        } catch (e) {
            console.log("db err", e);
            return res.status(200).write("Strava code update failed. <a href='https://health.crwnd.dev'>Back to site</a>");
        }
        console.log("db...");
    } catch (e) {
        console.log("strava err", e);
        return res.status(200).write("Strava code update failed. <a href='https://health.crwnd.dev'>Back to site</a>");
    }

    return res.redirect('https://health.crwnd.dev');
});

app.post("/api/strava-unlink/", forceAuthenticateToken, async (req, res) => {
    let user = await UsersModel.findOne({
        id: req.user.id,
    });

    try {
        if (user.sessions.find(el => el.id == req.user.i).isActive !== true) {
            return res.status(200).json({
                code: 1,
                message: "session-expired",
            });
        }
    } catch (e) {
        return res.status(200).json({
            code: 1,
            message: "session-expired",
        });
    }
    const now = Date.now() / 1000;

    try {
        console.log("requesting strava deauth...");
        let resp = await (await fetch("https://www.strava.com/oauth/deauthorize?access_token=" + await getStravaAccessToken(user), {
            method: "POST",
            redirect: 'follow'
        })).json();
        console.log("resp", resp);
        console.log("db...");
        try {
            await UsersModel.updateOne({
                id: req.user.id,
            }, { "strava": {} });
        } catch (e) {
            console.log("db err", e);
            return res.status(200).write("Strava code update failed. <a href='https://health.crwnd.dev'>Back to site</a>");
        }
        console.log("db...");
    } catch (e) {
        console.log("strava err", e);
        return res.status(200).write("Strava code update failed. <a href='https://health.crwnd.dev'>Back to site</a>");
    }

    try {
        await UsersModel.updateOne({
            id: req.user.id,
        }, { strava: {} });
    } catch (e) {
        return res.status(200).json({
            code: 2,
            message: "db-error",
        });
    }

    return res.status(200).json({
        code: 0,
        message: "success",
    });
});

app.post("/api/main-info/", async (req, res) => {
    let allChallenges = await challengesModel.find({}).limit(50);

    let allChallengesArr = [];
    for (let i = 0; i < allChallenges.length; i++) {
        let challenge = allChallenges[i];
        // let allParticipants = await UsersModel.find({ id: { $in: challenge.participants } }).limit(100);
        // let participantsData = {};
        // console.log("[main-info] filling participantsData...");
        // for (let i = 0; i < challenge.participants.length; i++) {
        //     switch (challenge.ctype) {
        //         case "daily":
        //             participantsData[challenge.participants[i].toString()] = challenge.participantsData[challenge.participants[i].toString()] || Array(challenge.longs);
        //             break;
        //         case "one-time":
        //             participantsData[challenge.participants[i].toString()] = [];
        //             try {
        //                 if (Object.entries(challenge.participantsData[challenge.participants[i].toString()]).length == 0) {
        //                     participantsData[challenge.participants[i].toString()] = [challenge.coordinates[0], allParticipants.find((part) => part.id == challenge.participants[i]).name];
        //                 } else {
        //                     let entrs = Object.entries(challenge.participantsData[challenge.participants[i].toString()]);
        //                     participantsData[challenge.participants[i].toString()] = [entrs[entrs.length - 1][1], allParticipants.find((part) => part.id == challenge.participants[i]).name];
        //                 }
        //             } catch (e) {
        //                 console.log(e);
        //                 participantsData[challenge.participants[i].toString()] = [challenge.coordinates[0], allParticipants.find((part) => part.id == challenge.participants[i]).name];
        //             }
        //             break;
        //     }
        // }
        allChallengesArr.push(await getChallengeObj(challenge))
    }

    return res.status(200).json({
        code: 0,
        message: "success",
        challenges: allChallengesArr,
    });
});

app.post("/api/create-challenge/", forceAuthenticateToken, async (req, res) => {
    let totalChallenges = await challengesModel.count({});
    let imageSource = "/static/previews/tomi-vadasz-SBKJ47obEHY-unsplash.jpg";
    let imageSquareSource = "/static/previews/tomi-vadasz-SBKJ47obEHY-unsplash.jpg";
    let markers = JSON.parse(req.body.markers);
    const timestamp = Math.round(Date.now() / 1000);
    switch (req.body.ctype) {
        case "one-time":
            console.log("markers", markers);
            try {
                let command = 'aria2c "https://api.mapbox.com/styles/v1/mapbox/streets-v11/static';

                for (let i = 0; i < markers.length; i++) {
                    command = command + (i == 0 ? "/" : ",") + "pin-s+555555(" + markers[i][0] + "," + markers[i][1] + ")";
                }

                command += `/` + getMiddlePoint(markers)[0] + `,` + getMiddlePoint(markers)[1] + `,12,0/320x180?access_token=pk.eyJ1IjoiY3J3bmQiLCJhIjoiY2xmaTQ1Y2NwMDVqbjNvcG41Z2x0d3Y2dCJ9.i0arSZ2VpeDgE6PZXVNUxg" --dir="/home/ubuntu/node/api/pics" --out="challenge_` + totalChallenges + `_` + timestamp + `.png"`;
                console.log("Trying to execute: ", command);
                await os.execCommand(command);
                console.log("Should be downloaded");
                imageSource = `https://api.crwnd.dev/pics/challenge_` + totalChallenges + `_` + timestamp + `.png`;
            } catch (e) {
                console.error("aria2c error", e);
                return res.status(200).json({
                    code: 3,
                    message: "map-error",
                });
            }
            try {
                let command = 'aria2c "https://api.mapbox.com/styles/v1/mapbox/streets-v11/static';

                for (let i = 0; i < markers.length; i++) {
                    command = command + (i == 0 ? "/" : ",") + "pin-s+555555(" + markers[i][0] + "," + markers[i][1] + ")";
                }

                command += `/` + getMiddlePoint(markers)[0] + `,` + getMiddlePoint(markers)[1] + `,12,0/200x200?access_token=pk.eyJ1IjoiY3J3bmQiLCJhIjoiY2xmaTQ1Y2NwMDVqbjNvcG41Z2x0d3Y2dCJ9.i0arSZ2VpeDgE6PZXVNUxg" --dir="/home/ubuntu/node/api/pics" --out="challenge_` + totalChallenges + `_square_` + timestamp + `.png"`;
                console.log("Trying to execute: ", command);
                await os.execCommand(command);
                console.log("Should be downloaded");
                imageSquareSource = `https://api.crwnd.dev/pics/challenge_` + totalChallenges + `_square_` + timestamp + `.png`;
            } catch (e) {
                console.error("aria2c error", e);
                return res.status(200).json({
                    code: 4,
                    message: "map-square-error",
                });
            }
            try {
                let newChallenge = new challengesModel({
                    id: totalChallenges,
                    created: Math.floor(Date.now() / 1000),
                    ctype: "one-time",
                    sport_type: req.body.sporttype,
                    deleted: false,
                    participants: [],
                    starts: req.body.time,
                    longs: req.body.longs * 60,
                    coordinates: markers,
                    participantsData: [],
                    owner: req.user.id,
                    image: imageSource,
                    image_square: imageSquareSource,
                    cname: req.body.name,
                    cdesc: req.body.description,
                    distance: 0
                });
                await newChallenge.save();
            } catch (e) {
                console.error("create-error", e);
                return res.status(200).json({
                    code: 2,
                    message: "create-error",
                });
            }
            break;
        case "daily":
            try {
                let newChallenge = new challengesModel({
                    id: totalChallenges,
                    created: Math.floor(Date.now() / 1000),
                    ctype: "daily",
                    sport_type: req.body.sporttype,
                    deleted: false,
                    participants: [],
                    starts: parseInt(req.body.time),
                    longs: parseInt(req.body.longs),
                    coordinates: [],
                    participantsData: [],
                    owner: parseInt(req.user.id),
                    image: imageSource,
                    image_square: imageSquareSource,
                    cname: req.body.name,
                    cdesc: req.body.description,
                    distance: parseInt(req.body.distance)
                });
                await newChallenge.save();
            } catch (e) {
                console.error("create-error", e);
                return res.status(200).json({
                    code: 2,
                    message: "create-error",
                });
            }
            break;
        default:
    }

    return res.status(200).json({
        code: 0,
        message: "success",
    });
});

app.post("/api/update-challenge/", forceAuthenticateToken, async (req, res) => {
    let challenge = await challengesModel.findOne({ id: parseInt(req.body.challengeid) });
    if (!challenge) {
        return res.status(200).json({
            code: 5,
            message: "not-found",
        });
    }
    let imageSource = "/static/previews/tomi-vadasz-SBKJ47obEHY-unsplash.jpg";
    let imageSquareSource = "/static/previews/tomi-vadasz-SBKJ47obEHY-unsplash.jpg";
    let markers = JSON.parse(req.body.markers);
    const timestamp = Math.round(Date.now() / 1000);
    switch (req.body.ctype) {
        case "one-time":
            console.log("markers", markers);
            try {
                let command = 'aria2c "https://api.mapbox.com/styles/v1/mapbox/streets-v11/static';

                for (let i = 0; i < markers.length; i++) {
                    command = command + (i == 0 ? "/" : ",") + "pin-s+555555(" + markers[i][0] + "," + markers[i][1] + ")";
                }

                command += `/` + getMiddlePoint(markers)[0] + `,` + getMiddlePoint(markers)[1] + `,12,0/320x180?access_token=pk.eyJ1IjoiY3J3bmQiLCJhIjoiY2xmaTQ1Y2NwMDVqbjNvcG41Z2x0d3Y2dCJ9.i0arSZ2VpeDgE6PZXVNUxg" --dir="/home/ubuntu/node/api/pics" --out="challenge_` + totalChallenges + `_` + timestamp + `.png"`;
                console.log("Trying to execute: ", command);
                await os.execCommand(command);
                console.log("Should be downloaded");
                imageSource = `https://api.crwnd.dev/pics/challenge_` + totalChallenges + `_` + timestamp + `.png`;
            } catch (e) {
                console.error("aria2c error", e);
                return res.status(200).json({
                    code: 3,
                    message: "map-error",
                });
            }
            try {
                let command = 'aria2c "https://api.mapbox.com/styles/v1/mapbox/streets-v11/static';

                for (let i = 0; i < markers.length; i++) {
                    command = command + (i == 0 ? "/" : ",") + "pin-s+555555(" + markers[i][0] + "," + markers[i][1] + ")";
                }

                command += `/` + getMiddlePoint(markers)[0] + `,` + getMiddlePoint(markers)[1] + `,12,0/200x200?access_token=pk.eyJ1IjoiY3J3bmQiLCJhIjoiY2xmaTQ1Y2NwMDVqbjNvcG41Z2x0d3Y2dCJ9.i0arSZ2VpeDgE6PZXVNUxg" --dir="/home/ubuntu/node/api/pics" --out="challenge_` + totalChallenges + `_square_` + timestamp + `.png"`;
                console.log("Trying to execute: ", command);
                await os.execCommand(command);
                console.log("Should be downloaded");
                imageSquareSource = `https://api.crwnd.dev/pics/challenge_` + totalChallenges + `_square_` + timestamp + `.png`;
            } catch (e) {
                console.error("aria2c error", e);
                return res.status(200).json({
                    code: 4,
                    message: "map-square-error",
                });
            }
            try {
                await challengesModel.updateOne({ id: parseInt(req.body.challengeid) }, {
                    "$set": {
                        sport_type: req.body.sporttype,
                        starts: req.body.time,
                        longs: req.body.longs * 60,
                        coordinates: markers,
                        image: imageSource,
                        image_square: imageSquareSource,
                        cname: req.body.name,
                        cdesc: req.body.description,
                        distance: 0
                    }
                });
            } catch (e) {
                console.error("create-error", e);
                return res.status(200).json({
                    code: 2,
                    message: "create-error",
                });
            }
            break;
        case "daily":
            try {
                await challengesModel.updateOne({ id: parseInt(req.body.challengeid) }, {
                    "$set": {
                        sport_type: req.body.sporttype,
                        starts: parseInt(req.body.time),
                        longs: parseInt(req.body.longs),
                        coordinates: [],
                        image: imageSource,
                        image_square: imageSquareSource,
                        cname: req.body.name,
                        cdesc: req.body.description,
                        distance: parseInt(req.body.distance)
                    }
                });
            } catch (e) {
                console.error("create-error", e);
                return res.status(200).json({
                    code: 2,
                    message: "create-error",
                });
            }
            break;
        default:
    }


    return res.status(200).json({
        code: 0,
        message: "success",
    });
});

async function getStravaAccessToken(user) {
    const timestamp = Math.round(Date.now() / 1000);
    if (user.strava.expires_at > timestamp) {
        return user.strava.access_token;
    }
    console.log(JSON.stringify({
        client_id: StravaCreds.client_id,
        client_secret: StravaCreds.client_secret,
        grant_type: 'refresh_token',
        refresh_token: user.strava.refresh_token,
    }));
    const response = await fetch('https://www.strava.com/api/v3/oauth/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            client_id: StravaCreds.client_id,
            client_secret: StravaCreds.client_secret,
            grant_type: 'refresh_token',
            refresh_token: user.strava.refresh_token,
        }),
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(`Failed to refresh access token: ${JSON.stringify(data)}`);
    }

    try {
        await UsersModel.updateOne({
            id: user.id,
        }, {
            $set: {
                "strava.refresh_token": data.refresh_token,
                "strava.access_token": data.access_token,
                "strava.expires_at": parseInt(data.expires_at)
            }
        });
    } catch (e) { console.log("new token update db error:", e); }

    return data.access_token;
}

app.post("/api/enroll-challenge/", forceAuthenticateToken, async (req, res) => {
    let challenge = await challengesModel.findOne({
        id: {
            $in: JSON.parse(req.body.challengeid),
        },
    });
    // console.error("challenge", challenge);

    if (!challenge) {
        return res.status(200).json({
            code: 1,
            message: "not-found",
        });
    }

    if (Array.from(challenge.participants).includes(parseInt(req.user.id))) {
        return res.status(200).json({
            code: 2,
            message: "already-enrolled",
        });
    }

    const timestamp = Math.round(Date.now() / 1000);

    if (timestamp > parseInt(challenge.starts)) {
        return res.status(200).json({
            code: 4,
            message: "already-started",
        });
    }

    let newParticipants = Array.from(challenge.participants);
    newParticipants.push(parseInt(req.user.id));

    try {
        await challengesModel.updateOne({ id: challenge.id }, { "$set": { "participants": newParticipants } });
    } catch (e) {
        console.error("challengesModel.updateOne", e);
        return res.status(200).json({
            code: 3,
            message: "db-error",
        });
    }
    return res.status(200).json({
        code: 0,
        message: "success",
    });
});

app.post("/api/leave-challenge/", forceAuthenticateToken, async (req, res) => {
    const timestamp = Math.round(Date.now() / 1000);
    let challenge = await challengesModel.findOne({
        id: {
            $in: JSON.parse(req.body.challengeid),
        },
    });
    // console.error("challenge", challenge);

    if (!challenge) {
        return res.status(200).json({
            code: 1,
            message: "not-found",
        });
    }
    if (challenge.starts < timestamp) {
        return res.status(200).json({
            code: 4,
            message: "already-started",
        });
    }

    if (!Array.from(challenge.participants).includes(parseInt(req.user.id))) {
        return res.status(200).json({
            code: 2,
            message: "not-participated",
        });
    }

    let newParticipants = Array.from(challenge.participants).filter((el) => el != req.user.id);

    try {
        await challengesModel.updateOne({ id: challenge.id }, { "$set": { "participants": newParticipants } });
    } catch (e) {
        console.error("challengesModel.updateOne", e);
        return res.status(200).json({
            code: 3,
            message: "db-error",
        });
    }
    return res.status(200).json({
        code: 0,
        message: "success",
    });
});

app.post("/api/ping-marathon-location/", forceAuthenticateToken, async (req, res) => {
    let challenge = await challengesModel.findOne({
        id: req.body.challengeid,
    });
    // console.error("challenge", challenge);

    if (!challenge) {
        return res.status(200).json({
            code: 1,
            message: "not-found",
        });
    }

    if (!Array.from(challenge.participants).includes(parseInt(req.user.id))) {
        return res.status(200).json({
            code: 2,
            message: "not-participated",
        });
    }

    const timestamp = Math.round(Date.now() / 1000);

    if (timestamp < parseInt(challenge.starts) || timestamp > parseInt(challenge.starts) + parseInt(challenge.longs)) {
        console.log("timestamp", timestamp);
        console.log("challenge.starts", challenge.starts);
        console.log("challenge.longs", challenge.longs);
        return res.status(200).json({
            code: 3,
            message: "challenge-is-not-active",
        });
    }

    let participantsData = challenge.participantsData;
    // console.log("req.body", req.body);
    if (Object.entries(participantsData).length == 0) {
        console.log("filling participantsData...");
        for (let i = 0; i < challenge.participants.length; i++) {
            participantsData[challenge.participants[i].toString()] = {};
            participantsData[challenge.participants[i].toString()][timestamp.toString()] = [];
            if (challenge.participants[i] == req.user.id) {
                participantsData[challenge.participants[i].toString()][timestamp.toString()] = JSON.parse(req.body.coordinates);
            }
        }
    }
    // console.log("participantsData", participantsData);

    participantsData[req.user.id.toString()][timestamp.toString()] = JSON.parse(req.body.coordinates);

    try {
        await challengesModel.updateOne({ id: challenge.id }, { "$set": { "participantsData": participantsData } });
    } catch (e) {
        console.error("challengesModel.updateOne", e);
        return res.status(200).json({
            code: 3,
            message: "db-error",
        });
    }
    return res.status(200).json({
        code: 0,
        message: "success",
    });
});

function countUserHighestStreak(participantsData, userID) {
    let highest = 0;
    let now = 0;
    try {
        for (let i = 0; i < participantsData[userID.toString()].length; i++) {
            if (participantsData[userID.toString()][i] == true) {
                now += 1;
            } else {
                if (highest < now) { highest = now; }
                now = 0;
            }
            if (highest < now) { highest = now; }
        }
    } catch (e) { console.log("countUserHighestStreak", e); }
    return highest;
}

async function getChallengeObj(challenge) {
    let participantsData = {};
    // console.log("[getChallengeObj] filling participantsData...");
    let allParticipants = await UsersModel.find({ id: { $in: challenge.participants } }).limit(100);
    let participantsProfiles = [];
    allParticipants.forEach((user) => {
        participantsProfiles.push({ name: user.name, id: user.id, data: challenge.ctype == "daily" ? countUserHighestStreak(challenge.participantsData, user.id) : 0, avatar: user.avatar });
    });
    for (let i = 0; i < challenge.participants.length; i++) {
        switch (challenge.ctype) {
            case "daily":
                participantsData[challenge.participants[i].toString()] = challenge.participantsData[challenge.participants[i].toString()] || Array(challenge.longs);
                break;
            case "one-time":
                participantsData[challenge.participants[i].toString()] = [];
                try {
                    if (Object.entries(challenge.participantsData[challenge.participants[i].toString()]).length == 0) {
                        participantsData[challenge.participants[i].toString()] = [challenge.coordinates[0], allParticipants.find((part) => part.id == challenge.participants[i]).name];
                    } else {
                        let entrs = Object.entries(challenge.participantsData[challenge.participants[i].toString()]);
                        participantsData[challenge.participants[i].toString()] = [entrs[entrs.length - 1][1], allParticipants.find((part) => part.id == challenge.participants[i]).name];
                    }
                } catch (e) {
                    console.log(e);
                    participantsData[challenge.participants[i].toString()] = [challenge.coordinates[0], allParticipants.find((part) => part.id == challenge.participants[i]).name];
                }
                break;
        }
    }
    return {
        id: challenge.id,
        created: challenge.created,
        ctype: challenge.ctype,
        sport_type: challenge.sport_type,
        deleted: challenge.deleted,
        participants: challenge.participants,
        participantsProfiles: participantsProfiles.sort(
            (a1, a2) => (a1.data < a2.data ? 1 : -1)
        ),
        starts: challenge.starts,
        longs: challenge.longs,
        coordinates: challenge.coordinates,
        participantsData: participantsData,
        owner: challenge.owner,
        image: challenge.image,
        image_square: challenge.image_square,
        cname: challenge.cname,
        cdesc: challenge.cdesc,
        distance: challenge.distance
    };
}

app.post("/api/get-challenge-info/", async (req, res) => {
    let challenge = await challengesModel.findOne({
        id: req.body.challengeid,
    });

    // console.log("challenge", challenge);

    if (!challenge) {
        return res.status(200).json({
            code: 1,
            message: "not-found",
        });
    }

    return res.status(200).json({
        code: 0,
        message: "success",
        content: await getChallengeObj(challenge),
    });
});

app.post("/api/get-history-day/", forceAuthenticateToken, async (req, res) => {
    let user = await UsersModel.findOne({
        id: req.user.id,
    });
    console.log('https://www.strava.com/api/v3/activities?before=' + (parseInt(req.body.epoch) + 24 * 60 * 60).toString() + "&after=" + parseInt(req.body.epoch).toString());

    const response = await fetch('https://www.strava.com/api/v3/activities?before=' + (parseInt(req.body.epoch) + 24 * 60 * 60).toString() + "&after=" + parseInt(req.body.epoch).toString(), {
        method: 'GET',
        headers: {
            "Authorization": "Bearer " + await getStravaAccessToken(user)
        },
    });
    let data = await response.json();
    if (!response.ok) {
        console.log(`Failed to get data: ${data.message}`);
        data = [];
    }
    console.log("data", data);

    return res.status(200).json({
        code: 0,
        message: "success",
        content: data,
    });
});

app.post("/api/kick-participant/", forceAuthenticateToken, async (req, res) => {
    console.log("[kick-participant] req.body", req.body);
    let challenge = await challengesModel.findOne({
        id: req.body.challengeid,
    });

    if (!challenge) {
        return res.status(200).json({
            code: 1,
            message: "not-found",
        });
    }
    let user = await UsersModel.findOne({
        id: req.user.id,
    });
    if (!user.admin) {
        return res.status(200).json({
            code: 2,
            message: "not-admin",
        });
    }

    let newParticipants = challenge.participants;
    if (newParticipants.indexOf(parseInt(req.body.userid)) > -1) {
        newParticipants.splice(newParticipants.indexOf(parseInt(req.body.userid)), 1);
    }

    await challengesModel.updateOne({ id: challenge.id }, { "$set": { participants: newParticipants } });

    return res.status(200).json({
        code: 0,
        message: "success",
        content: await getChallengeObj(challenge),
    });
});

app.post("/api/update-challenge-day/", forceAuthenticateToken, async (req, res) => {
    let challenge = await challengesModel.findOne({
        id: req.body.challengeid,
    });

    // console.log("challenge", challenge);

    if (!challenge) {
        return res.status(200).json({
            code: 1,
            message: "not-found",
        });
    }
    if (challenge.ctype != "daily") {
        return res.status(200).json({
            code: 1,
            message: "not-supported",
        });
    }
    if (!challenge.participants.includes(parseInt(req.user.id))) {
        return res.status(200).json({
            code: 2,
            message: "not-member",
        });
    }
    let user = await UsersModel.findOne({
        id: req.user.id,
    });

    const day = parseInt(req.body.day);

    let participantsData = {};
    // console.log("[update-challenge-day] filling participantsData...");
    for (let i = 0; i < challenge.participants.length; i++) {
        participantsData[challenge.participants[i].toString()] = challenge.participantsData[challenge.participants[i].toString()] || Array(challenge.longs);
        try {
            if (challenge.participants[i] == user.id) {
                if (participantsData[challenge.participants[i].toString()][parseInt(day)] != true) {
                    const timestamp = Math.round(Date.now() / 1000);
                    // console.log('https://www.strava.com/api/v3/activities?before=' + (challenge.starts + 24 * 60 * 60 * (day + 1)).toString() + "&after=" + (challenge.starts + 24 * 60 * 60 * (day)).toString());
                    const response = await fetch('https://www.strava.com/api/v3/activities?before=' + (challenge.starts + 24 * 60 * 60 * (day + 1)).toString() + "&after=" + (challenge.starts + 24 * 60 * 60 * (day)).toString(), {
                        method: 'GET',
                        headers: {
                            "Authorization": "Bearer " + await getStravaAccessToken(user)
                        },
                    });
                    const data = await response.json();
                    if (!response.ok) {
                        throw new Error(`Failed to refresh access token: ${data.message}`);
                    }
                    console.log("data", data);
                    let totalMeters = 0;
                    for (let i = 0; i < data.length; i++) {
                        switch (challenge.sport_type) {
                            case "run":
                                if (data[i].sport_type == "Run") {
                                    totalMeters += data[i].distance;
                                }
                                break;
                            case "walk":
                                if (data[i].sport_type == "Walk") {
                                    totalMeters += data[i].distance;
                                }
                                break;
                            case "cycling":
                                if (data[i].sport_type == "Handcycle") {
                                    totalMeters += data[i].distance;
                                }
                                break;
                        }
                    }
                    console.log("totalMeters", totalMeters);
                    participantsData[challenge.participants[i].toString()][parseInt(day)] = totalMeters >= challenge.distance;
                }
            }
        } catch (e) {
            console.log(e);
        }
    }

    try {
        await challengesModel.updateOne({ id: challenge.id }, { "$set": { "participantsData": participantsData } });
    } catch (e) {
        console.error("challengesModel.updateOne", e);
        return res.status(200).json({
            code: 3,
            message: "db-error",
        });
    }

    challenge.participantsData = participantsData;

    return res.status(200).json({
        code: 0,
        message: "success",
        content: await getChallengeObj(challenge)
    });
});

app.post("/api/auth/signup/", async (req, res) => {
    let amountOfUsers = await UsersModel.count({});
    const newToken = generateAccessToken(parseInt(amountOfUsers), 0);
    let isEmailTaken = await UsersModel.findOne({ $or: [{ 'email': req.body.email }] });
    if (isEmailTaken != undefined) {
        return res.status(200).json({
            code: 1,
            message: "email-taken",
        });
    }
    let cookieArgs = {
        maxAge: cookieMaxAge,
        httpOnly: true,
        path: "/",
        domain: 'crwnd.dev',
        secure: true
    };
    res.cookie("health-authorization", newToken, cookieArgs);
    console.log("req.body", req.body);
    try {
        let newUser = new UsersModel({
            id: amountOfUsers,
            email: req.body.email,
            admin: false,
            name: req.body.name || "name",
            lastActive: Date.now(),
            password: req.body.pass,
            sessions: [{ isActive: true, started: Date.now(), infoString: "WebApp", id: 0 }],
            addresses: [],
            avatar: "/static/user-avatars/person.png",
            publicProfile: true,
            created: Math.floor(Date.now() / 1000),
            deleted: false,
            strava: {}
        });
        await newUser.save();
    } catch (e) {
        console.error("create-error", e);
        return res.status(200).json({
            code: 2,
            message: "create-error",
        });
    }

    return res.status(200).json({
        code: 0,
        message: "success",
        avatar: "/static/user-avatars/person.png",
        sessions: [{ isActive: true, started: Date.now(), infoString: "WebApp", id: 0 }],
        name: req.body.name,
        email: req.body.email,
    });
});

app.post("/api/auth/signin/", async (req, res) => {
    let user = await UsersModel.findOne({
        email: req.body.email,
    });

    if (!user || user === null) {
        return res.status(404).json({
            code: 1,
            message: "user not found",
        });
    }

    if (user.password != req.body.pass) {
        return res.status(401).json({
            code: 1,
            message: "pass-wrong",
        });
    }

    user.lastActive = Math.round(new Date().getTime() / 1000);
    let sessionID = user.sessions[user.sessions.length - 1].id + 1 || 0;
    user.sessions.push({
        id: sessionID,
        isActive: true,
        infoString: "WebApp",
        started: Math.round(new Date().getTime() / 1000)
    });
    user.save();

    const newToken = generateAccessToken(parseInt(user.id), sessionID);
    let cookieArgs = {
        maxAge: cookieMaxAge,
        httpOnly: true,
        path: "/",
        secure: true,
        domain: 'crwnd.dev'
    };
    // cookieArgs.secure = process.env.SERVER_ENV == "production";
    res.cookie("health-authorization", newToken, cookieArgs);

    return res.status(200).json({
        code: 0,
        message: "success"
    });
});

// app.post("/api/users/lookup/", async (req, res) => {
//     // console.log('req.body: ', req.body);
//     let user = await UsersModel.findOne({
//         username: req.body.username,
//     });
//     if (user) {
//         return res.status(200).json({
//             code: 0,
//             message: "success",
//             name: user.name,
//             avatar: user.avatar,
//             publicProfile: user.publicProfile,
//             admin: user.admin,
//         });
//     } else {
//         return res.status(400).json({
//             code: 1,
//             message: "not-found",
//         });
//     }
// });

app.post("/api/auth/logout/", authenticateToken, async (req, res) => {
    if (req.user) {
        try {
            // await UsersModel.findOneAndUpdate({id: req.user.id, sessions:{"$elemMatch":{}}})
            let user = await UsersModel.findOne({ id: req.user.id });
            user.sessions[parseInt(req.user.i)].isActive = false;
            user.save();
            await UsersModel.updateOne({ id: req.user.id }, { "$set": { "sessions": user.sessions } });
            console.log("session should become expired now");
        } catch (e) { console.error("auth/logout user invalidate session failed: ", e); }
    }
    let cookieArgs = {
        path: "/",
        httpOnly: true,
        domain: 'crwnd.dev',
        secoure: true
    };
    res.clearCookie("health-authorization", cookieArgs);
    return res.status(200).json({
        code: 0,
        message: "success",
    });
});

app.post("/api/", authenticateToken, (req, res) => {
    return res.send("Useless server response (\nSeriously, its useless");
});

function authenticateToken(req, res, next) {
    // Unlike forceAuthenticateToken(), this function will not stop the request if the user is not authenticated
    const authHeader = req.cookies["health-authorization"];
    console.log("authenticateToken authHeader: ", authHeader);
    const token = authHeader; // && authHeader.split(' ')[1];

    if (token == null || token == undefined || token == "") {
        req.user = undefined;
        next();
    } else {
        jsonwebtoken.verify(token, process.env.TOKEN_SECRET, (err, user) => {
            if (err) {
                console.error("jsonwebtoken err:", err);

                req.user = undefined;
                next();
            } else {
                req.user = user;
                req.accessToken = token;
                console.log("user: ", user);
                next();
            }
        });
    }
}
function forceAuthenticateToken(req, res, next) {
    // Unlike authenticateToken(), this function will stop the request if the user is not authenticated
    const authHeader = req.cookies["health-authorization"];
    console.log("forceAuthenticateToken authHeader: ", authHeader);
    const token = authHeader; // && authHeader.split(' ')[1];

    if (token == null || token == undefined || token == "") {
        let cookieArgs = {
            path: "/",
            httpOnly: true,
        };
        // if (process.env.SERVER_ENV == "production") {
        cookieArgs.secure = true;
        // }
        // res.clearCookie("health-authorization", cookieArgs);
        console.log("-/-/-/-/-/-/-/-/-/- token is null or undefined", token);
        return res.sendStatus(403);
    } else {
        jsonwebtoken.verify(token, process.env.TOKEN_SECRET, (err, user) => {
            if (err) {
                console.error("jsonwebtoken err:", err);

                let cookieArgs = {
                    path: "/",
                    httpOnly: true,
                };
                // if (process.env.SERVER_ENV == "production") {
                cookieArgs.secure = true;
                // }
                // res.clearCookie("health-authorization", cookieArgs);
                console.log("-/-/-/-/-/-/-/-/-/- token was invalid", token);
                return res.sendStatus(403);
            } else {
                req.user = user;
                req.accessToken = token;
                console.log("user: ", user);
                next();
            }
        });
    }
}

function generateAccessToken(userID, sessionNumber) {
    return jsonwebtoken.sign(
        {
            id: userID,
            i: sessionNumber //i - index of session
        },
        process.env.TOKEN_SECRET, {
        expiresIn: "1800h",
    });
}
app.use('/pics', express.static(path.join(__dirname, 'pics')));
app.all("/", (req, res, next) => {
    return res.json({ err: 404 });
});

app.listen(httpPort, () => {
    console.log("Listening on port ", httpPort);
});
