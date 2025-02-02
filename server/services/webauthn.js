/*jslint node, unordered */

// USING: https://github.com/webauthn-open-source/fido2-lib
// ALTERNATE: https://github.com/Jxck/jxck.io/blob/main/labs.jxck.io/webauthentication/fido-u2f/app.mjs
// ALT 2: https://github.com/ais-one/cookbook/blob/develop/js-node/expressjs/router/fido.js
// and https://github.com/ais-one/cookbook/blob/develop/js-node/expressjs/public/demo-express/fido.html
// FLOW: https://webauthn.guide/
// https://developers.yubico.com/WebAuthn/WebAuthn_Developer_Guide/WebAuthn_Client_Registration.html
//
(function (exports) {
    "use strict";
    const f = require("../../common/core");
    const datasource = require("../datasource");
    const {Fido2Lib} = require("fido2-lib");
    const crypto = require("crypto");
    let challenges = {};

    let fido2Lib;
    let rpId;
    let originUrl = "http://localhost";

    function b64_b64url(inStr) {
        return inStr.replace(
            /\+/g,
            "-"
        ).replace(
            /\//g,
            "_"
        ).replace(
            /\=/g,
            ""
        );
    }
    function b64url_b64(inStr) {
        inStr = inStr.replace(
            /-/g,
            "+"
        ).replace(
            /_/g,
            "/"
        );
        inStr = inStr + "=".repeat(
            (inStr.length % 4)
            ? 4 - (inStr.length % 4)
            : 0
        );
        return inStr;
    }
    function b64_b(inStr) {
        return Buffer.from(inStr, "base64");
    }
    function b_b64(buf) {
        return Buffer.from(buf).toString("base64");
    }
    function b64url_b(inStr) {
        return b64_b(b64url_b64(inStr));
    }
    function b_b64url(buf) {
        return b64_b64url(b_b64(buf));
    }

    function b_ab(buf) {
        return buf.buffer.slice(
            buf.byteOffset,
            buf.byteOffset + buf.byteLength
        );
    }
    function ab_b(byteArray) {
        return Buffer.from(byteArray);
    }

    function init(rid, origin) {
        originUrl = origin;
        rpId = rid;
        fido2Lib = new Fido2Lib({
            timeout: 120000,
            rpId: rid,
            rpName: "FeatherBone",
            rpIcon: "https://localhost/featherbone.png",
            challengeSize: 128,
            attestation: "none",
            cryptoParams: [-7, -257],
            authenticatorAttachment: "platform",
            authenticatorRequireResidentKey: false,
            authenticatorUserVerification: "required"
        });
    }

    async function findUserAccount(name) {
        let object = {
            method: "GET",
            name: "UserAccount",
            user: "featheradmin",
            "filter": {
                "limit": 1,
                "offset": 0,
                "criteria": [
                    {
                        "property": [
                            "id",
                            "name",
                            "contact.fullName"
                        ],
                        "operator": "~*",
                        "value": name
                    }
                ]
            }
        };
        return await datasource.request(object, true);
    }
    async function findCredentials(name, byId) {
        let object = {
            method: "GET",
            name: "WebauthnCredential",
            user: "featheradmin",
            properties: [
                "id",
                "user.id",
                "credentialId",
                "counter",
                "publicKey"
            ],
            filter: {
                "limit": 20,
                "offset": 0,
                "criteria": [
                    {
                        "property": [
                            (
                                (byId)
                                ? "credentialId"
                                : "user.name"
                            )
                        ],
                        "operator": "=",
                        "value": name
                    }
                ]
            },
            "showDeleted": false
        };
        if(byId){
            console.log(object.filter.criteria);
        }
        return await datasource.request(object, true);
    }

    async function createCredential(userId, credentialId, counter, publicKey) {
        let id = f.createId();
        let nowIso = new Date().toISOString();
        let data = {
            "id": id,
            "created": nowIso,
            "createdBy": "",
            "updated": nowIso,
            "updatedBy": "",
            "isDeleted": false,
            "objectType": "",
            "user": {
                "id": userId
            },
            "credentialId": credentialId,
            "counter": counter,
            "publicKey": publicKey,
            "rpId": rpId,
            "originUrl": originUrl
        };
        let payload = {
            name: "WebauthnCredential",
            method: "POST",
            user: "featheradmin",
            eventKey: undefined,
            id: undefined,
            data
        };
        return await datasource.request(payload, true);
    }

    async function doWebAuthNRegister(req, res) {

        let users = await findUserAccount(req.user.name);
        let user = users[0];
        let registrationOptions = await fido2Lib.attestationOptions();
        registrationOptions.user.id = user.id;
        registrationOptions.user.name = user.name;

        /// Could be contact name
        registrationOptions.user.displayName = user.name;
        let randId = crypto.randomUUID();
        registrationOptions.challenge = randId;

        /// Challenge needs to be put into the session
        /// or an HA location for ephemeral values
        challenges[user.name] = randId;

        res.writeHeader(200, "application/json");
        res.write(JSON.stringify(registrationOptions));
        res.end();
    }

    async function postWebAuthNRegister(req, res) {

        let pkc = req.body;
        let users = await findUserAccount(req.user.name);
        let user = users[0];

        // Decode the raw id, which is the same as the credential id
        pkc.rawId = b_ab(b64url_b(pkc.rawId));

        /// encode the challenge into a buffer
        let challenge = b64_b(b64url_b64(challenges[user.name]));

        const attestationExpectations = {
            challenge,
            origin: originUrl,
            factor: "either"
        };
        console.log(attestationExpectations);
        /// will throw an error
        const regResult = await fido2Lib.attestationResult(
            pkc,
            attestationExpectations
        );

        const authnrData = regResult.authnrData;
        const credId = b_b64(new Uint8Array(authnrData.get("credId")));
        let publicKey = authnrData.get("credentialPublicKeyPem");
        let counter = parseInt(authnrData.get("counter"));
        console.log("Cred Id", credId);
        console.log("Public Key", publicKey);
        console.log("counter", counter);

        let createRet = await createCredential(
            user.id,
            credId,
            counter,
            publicKey
        );
        res.writeHeader(200, "application/json");
        res.write(JSON.stringify(createRet));
        res.end();
    }

    async function doWebAuthNAuthenticate(req, res) {
        let users = await findUserAccount(req.user.name);
        let user = users[0];

        let creds = await findCredentials(req.user.name);
        console.log(creds);
        let authnOptions;
        if (creds.length) {
            authnOptions = await fido2Lib.assertionOptions();
            challenges[user.name] = authnOptions.challenge;
            authnOptions.challenge = b_b64url(ab_b(authnOptions.challenge));
            authnOptions.allowCredentials = [];
            creds.forEach(function (cred) {
                let credId = cred.credentialId;
                authnOptions.allowCredentials.push({
                    type: "public-key",
                    id: credId
                    //,transports: ["internal"]
                });
            });
        } else {
            authnOptions = {
                registrationRequired: true
            };
        }
        res.writeHeader(200, "application/json");
        res.write(JSON.stringify(authnOptions));
        res.end();
    }

    async function postWebAuthNAuthenticate(req, res) {
        let pkc = req.body;
        let users = await findUserAccount(req.user.name);
        let creds = await findCredentials(pkc.rawId, true);
        let user = users[0];
        let cred = creds[0];
        let result = {
            authenticated: false,
            error: false,
            message: null
        };
        if (cred && user) {
            pkc.rawId = b_ab(b64url_b(pkc.rawId));
            // let handle = pkc.response.userHandle;
            pkc.response.userHandle = "null";
            const assertionExpectations = {
                challenge: b_b64url(ab_b(challenges[user.name])),
                origin: originUrl,
                factor: "either",
                publicKey: cred.publicKey,
                prevCounter: 0,
                userHandle: "null"
            };
            assertionExpectations.allowCredentials = [];
            assertionExpectations.allowCredentials.push({
                type: "public-key",
                id: pkc.rawId
            });
            console.log(assertionExpectations);
            try {
                await fido2Lib.assertionResult(pkc, assertionExpectations);
                result.authenticated = true;
            } catch (e) {
                console.error(e);
                result.error = true;
            }
        } else {
            console.log("Credential", cred);
            console.error("Missing credential", pkc.rawId);
            result.error = true;
            result.message = "User or credential missing";
        }

        res.writeHeader(200, "application/json");
        res.write(JSON.stringify(result));
        res.end();

        //let td = new TextDecoder();
    }

    exports.webauthn = {
        doWebAuthNAuthenticate,
        doWebAuthNRegister,
        postWebAuthNRegister,
        postWebAuthNAuthenticate,
        init
    };
}(exports));