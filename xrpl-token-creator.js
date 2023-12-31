const xrpl = require('xrpl');
const readlineSync = require('readline-sync');

// Mapping of flag names to their numeric values
const flagNameToValue = {
    "asfRequireDest": xrpl.AccountSetAsfFlags.asfRequireDest,
    "asfRequireAuth": xrpl.AccountSetAsfFlags.asfRequireAuth,
    "asfDisallowXRP": xrpl.AccountSetAsfFlags.asfDisallowXRP,
    "asfDisableMaster": xrpl.AccountSetAsfFlags.asfDisableMaster,
    "asfAccountTxnID": xrpl.AccountSetAsfFlags.asfAccountTxnID,
    "asfNoFreeze": xrpl.AccountSetAsfFlags.asfNoFreeze,
    "asfGlobalFreeze": xrpl.AccountSetAsfFlags.asfGlobalFreeze,
    "asfDefaultRipple": xrpl.AccountSetAsfFlags.asfDefaultRipple,
    "asfDepositAuth": xrpl.AccountSetAsfFlags.asfDepositAuth,
    "asfAllowTrustLineClawback": xrpl.AccountSetAsfFlags.asfAllowTrustLineClawback,
    "asfAuthorizedNFTokenMinter": xrpl.AccountSetAsfFlags.asfAuthorizedNFTokenMinter,
    "asfDisallowIncomingCheck": xrpl.AccountSetAsfFlags.asfDisallowIncomingCheck,
    "asfDisallowIncomingNFTokenOffer": xrpl.AccountSetAsfFlags.asfDisallowIncomingNFTokenOffer,
    "asfDisallowIncomingPayChan": xrpl.AccountSetAsfFlags.asfDisallowIncomingPayChan,
    "asfDisallowIncomingTrustline": xrpl.AccountSetAsfFlags.asfDisallowIncomingTrustline
};

// Function to get numeric value of a flag
function getFlagValue(flagName) {
    return flagNameToValue[flagName] || null;
}

// Function to Display Flag Options and Allow Multiple Selections
function selectFlags(message) {
    const flagNames = Object.keys(flagNameToValue);
    let selectedFlags = [];
    let index = 0;

    while (index !== -1) {
        console.log(message);
        index = readlineSync.keyInSelect(flagNames, 'Choose a flag:', { cancel: 'Done' });
        if (index !== -1 && !selectedFlags.includes(flagNames[index])) {
            selectedFlags.push(flagNames[index]);
        }
    }
    return selectedFlags.length > 0 ? selectedFlags : null;
}

// Function to connect to the XRPL
async function connectToXRPL() {
    const client = new xrpl.Client("wss://s.devnet.rippletest.net:51233/");
    // const client = new xrpl.Client("wss://xrplcluster.com/");
    // const client = new xrpl.Client("wss://s1.ripple.com/");
    await client.connect();
    return client;
}

// Function to check the connection and reconnect if necessary
async function ensureConnection(client) {
    if (!client.isConnected()) {
        console.log("Client is not connected, attempting to reconnect...");
        await client.connect();
    } else {
        try {
            console.log("Sending ping to test connection...");
            await client.request({ command: "ping" });
        } catch (error) {
            console.log("Ping failed, attempting to reconnect...", error);
            await client.connect();
        }
    }
}

// Function to create a new wallet
function createWallet(client) {
    // return xrpl.Wallet.generate();
    const wallet = xrpl.Wallet.generate();
    console.log('Generated Wallet:', wallet);
    return wallet;
}

// Function to check if an account is activated
async function isAccountActivated(client, address) {
    try {
        const accountInfo = await client.request({
            command: "account_info",
            account: address,
            ledger_index: "validated"
        });
        return accountInfo.result.account_data !== undefined;
    } catch (error) {
        // If the error is "actNotFound", the account is not activated
        return false;
    }
}

// Function checks if the RegularKey of the issuer wallet is set to the black hole address
async function isRegularKeySetToBlackHole(client, issuerWallet) {
    const accountInfo = await client.request({
        command: "account_info",
        account: issuerWallet.classicAddress,
        ledger_index: "validated"
    });
    return accountInfo.result.account_data.RegularKey === "rrrrrrrrrrrrrrrrrrrrrhoLvTp";
}

// Function checks if the master key of the issuer wallet is disabled
async function isMasterKeyDisabled(client, issuerWallet) {
    const accountInfo = await client.request({
        command: "account_info",
        account: issuerWallet.classicAddress,
        ledger_index: "validated"
    });
    return accountInfo.result.account_data.Flags & xrpl.AccountSetAsfFlags.asfDisableMaster;
}

// Function to check if a trust line already exists
async function trustLineExists(client, account, currencyCode, issuerAddress) {
    const response = await client.request({
        command: "account_lines",
        account: account,
        ledger_index: "validated"
    });

    return response.result.lines.some(line =>
        line.currency === currencyCode && line.account === issuerAddress
    );
}

// Function to check and set a trust line with a custom limit
async function setTrustLine(client, currencyCode, issuerAddress, receiverWallet, limitValue) {
    // Check if the trust line already exists
    console.log(`Checking if a trust line for ${currencyCode} already exists...`);
    if (await trustLineExists(client, receiverWallet.classicAddress, currencyCode, issuerAddress)) {
        console.log("Trust line already exists.");
        return;
    }
    const trustSetTx = {
        "TransactionType": "TrustSet",
        "Account": receiverWallet.classicAddress,
        "LimitAmount": {
            "currency": currencyCode,
            "issuer": issuerAddress,
            "value": limitValue // Use the custom limit value
        }
    };
    console.log("Preparing TrustSet transaction...");
    const prepared = await client.autofill(trustSetTx);
    // console.log("TrustSet transaction prepared:", JSON.stringify(prepared));

    console.log("Signing TrustSet transaction...");
    const signed = receiverWallet.sign(prepared);
    console.log("TrustSet transaction signed.");

    await ensureConnection(client); // Ensure connection

    console.log("Submitting TrustSet transaction...");
    const result = await client.submitAndWait(signed.tx_blob);
    console.log("TrustSet transaction result:", JSON.stringify(result, null, 2));

    return result;
}

// Function to issue tokens
async function issueToken(client, currencyCode, issuerWallet, receiverAddress, amount) {
    console.log(`Preparing token issuance transaction for ${amount} ${currencyCode}...`);

    const issueTx = {
        "TransactionType": "Payment",
        "Account": issuerWallet.classicAddress,
        "Amount": {
            "currency": currencyCode,
            "issuer": issuerWallet.classicAddress,
            "value": amount
        },
        "Destination": receiverAddress
    };
    const prepared = await client.autofill(issueTx);
    // console.log("Token issuance transaction prepared:", JSON.stringify(prepared));

    console.log("Signing token issuance transaction...");
    const signed = issuerWallet.sign(prepared);
    console.log("Token issuance transaction signed.");

    await ensureConnection(client); // Ensure connection

    console.log("Submitting token issuance transaction...");
    const result = await client.submitAndWait(signed.tx_blob);
    console.log("Token issuance transaction result:", JSON.stringify(result, null, 2));

    return result;
}

// Function to set or clear account flags with separate transactions for each flag
async function setAccountFlags(client, wallet, setFlags, clearFlags) {
    let results = [];

    // Process each set flag in a separate transaction
    for (const setFlag of setFlags) {
        console.log(`Setting flag ${setFlag}...`);

        const settingsTx = {
            "TransactionType": "AccountSet",
            "Account": wallet.classicAddress,
            "SetFlag": setFlag
        };

        const prepared = await client.autofill(settingsTx);
        // console.log("AccountSet (SetFlag) transaction prepared:", JSON.stringify(prepared));

        console.log("Signing AccountSet (SetFlag) transaction...");
        const signed = wallet.sign(prepared);
        console.log("AccountSet (SetFlag) transaction signed.");

        await ensureConnection(client); // Ensure connection

        console.log("Submitting AccountSet (SetFlag) transaction...");
        const result = await client.submitAndWait(signed.tx_blob);
        console.log("AccountSet (SetFlag) transaction result:", JSON.stringify(result, null, 2));

        results.push(result);
    }

    // Process each clear flag in a separate transaction
    for (const clearFlag of clearFlags) {
        console.log(`Clearing flag ${clearFlag}...`);

        const settingsTx = {
            "TransactionType": "AccountSet",
            "Account": wallet.classicAddress,
            "ClearFlag": clearFlag
        };

        const prepared = await client.autofill(settingsTx);
        // console.log("AccountSet (ClearFlag) transaction prepared:", JSON.stringify(prepared));

        console.log("Signing AccountSet (ClearFlag) transaction...");
        const signed = wallet.sign(prepared);
        console.log("AccountSet (ClearFlag) transaction signed.");

        await ensureConnection(client); // Ensure connection

        console.log("Submitting AccountSet (ClearFlag) transaction...");
        const result = await client.submitAndWait(signed.tx_blob);
        console.log("AccountSet (ClearFlag) transaction result:", JSON.stringify(result, null, 2));

        results.push(result);
    }

    return results;
}

async function blackHoleIssuer(client, issuerWallet) {
    try {
        // Set the RegularKey to the black hole address if not already set
        const setRegularKeyTx = {
            "TransactionType": "SetRegularKey",
            "Account": issuerWallet.classicAddress,
            "RegularKey": "rrrrrrrrrrrrrrrrrrrrrhoLvTp"
        };

        let prepared = await client.autofill(setRegularKeyTx);
        let signed = issuerWallet.sign(prepared);

        await ensureConnection(client); // Ensure connection

        let result = await client.submitAndWait(signed.tx_blob);

        // Check if setting the regular key was successful
        if (result.result.meta.TransactionResult === 'tesSUCCESS') {
            console.log('Regular key set to "black hole" address.');
        } else {
            console.log(`Failed to set regular key. Result: ${JSON.stringify(result, null, 2)}`);
        }

        // Disable the master key
        const disableMasterKeyTx = {
            "TransactionType": "AccountSet",
            "Account": issuerWallet.classicAddress,
            "SetFlag": xrpl.AccountSetAsfFlags.asfDisableMaster
        };

        prepared = await client.autofill(disableMasterKeyTx);
        signed = issuerWallet.sign(prepared);

        await ensureConnection(client); // Ensure connection

        result = await client.submitAndWait(signed.tx_blob);

        // Check if disabling the master key was successful
        if (result.result.meta.TransactionResult === 'tesSUCCESS') {
            console.log('Master key disabled. Issuer address has been fully black holed.');
        } else {
            console.log(`Failed to disable master key. Result: ${JSON.stringify(result, null, 2)}`);
        }
    } catch (error) {
        console.error(`An error occurred: ${error.message}`);
    }
}

function logInfo(message) {
    console.log(`INFO: ${message}`);
}

function logWarning(message) {
    console.log(`WARNING: ${message}`);
}

function logError(message) {
    console.log(`ERROR: ${message}`);
}

function logSectionHeader(title) {
    console.log("\n#######################################################################\n");
    console.log(`SECTION: ${title}`);
}

async function main() {
    let client;
    try {
        // const client = new xrpl.Client("wss://s.devnet.rippletest.net:51233/");
        client = await connectToXRPL();
        await ensureConnection(client); // Ensure connection
        console.log("Connected to the XRP Ledger.");

        // Get or create issuer wallet
        let issuerWallet;
        if (readlineSync.keyInYN('Do you already have an issuer wallet?')) {
            const issuerAddress = readlineSync.question('Enter the issuer address: ');
            const issuerSecret = readlineSync.question('Enter the issuer secret: ', { hideEchoBack: true });
            issuerWallet = xrpl.Wallet.fromSecret(issuerSecret);
            if (!await isAccountActivated(client, issuerWallet.classicAddress)) {
                console.log(`Account ${issuerWallet.classicAddress} is not activated. Please fund it with the minimum required XRP.`);
                client.disconnect();
                return;
            }
        } else {
            issuerWallet = createWallet(client);
            if (!await isAccountActivated(client, issuerWallet.classicAddress)) {
                console.log(`Account ${issuerWallet.classicAddress} is not activated. Please fund it with the minimum required XRP.`);
                client.disconnect();
                return;
            }
        }

        // Check if the RegularKey is set to the black hole address
        if (await isRegularKeySetToBlackHole(client, issuerWallet)) {
            console.log('Regular key is already set to the "black hole" address.');
            // Optional: Handle this scenario, perhaps exit the script or provide options
            client.disconnect();
            return; // or process.exit(0) to forcefully exit the script

        }

        // Check if the master key is disabled
        if (await isMasterKeyDisabled(client, issuerWallet)) {
            console.log('Master key is already disabled.');
            // Optional: Handle this scenario
            client.disconnect();
            return; // or process.exit(0) to forcefully exit the script
        }

        // Get or create receiver wallet
        let receiverWallet;
        if (readlineSync.keyInYN('Do you already have a receiver wallet?')) {
            const receiverAddress = readlineSync.question('Enter the receiver address: ');
            const receiverSecret = readlineSync.question('Enter the receiver secret: ', { hideEchoBack: true });
            receiverWallet = xrpl.Wallet.fromSecret(receiverSecret);
            if (!await isAccountActivated(client, receiverWallet.classicAddress)) {
                console.log(`Account ${receiverWallet.classicAddress} is not activated. Please fund it with the minimum required XRP.`);
                client.disconnect();
                return;
            }
        } else {
            receiverWallet = createWallet(client);
            // console.log(`Receiver Wallet created. Address: ${receiverWallet.classicAddress}, Secret: ${receiverWallet.seed}`);
            if (!await isAccountActivated(client, receiverWallet.classicAddress)) {
                console.log(`Account ${receiverWallet.classicAddress} is not activated. Please fund it with the minimum required XRP.`);
                client.disconnect();
                return;
            }
        }

        // Section 1: Default Ripple
        logSectionHeader("Default Ripple");

        logInfo("The Default Ripple flag 'asfDefaultRipple' is an account setting that enables rippling on all incoming trust lines by default.");
        logInfo("Issuers MUST enable this flag for their customers to be able to send tokens to each other.");
        logInfo("It's best to enable it before setting up any trust lines or issuing any tokens.");
        logInfo("The Default Ripple setting of your account does not affect trust lines that you create.");
        logInfo("Only trust lines that others open to you.");
        logInfo("If you change the Default Ripple setting of your account, trust lines that were created before the change keep their existing No Ripple settings.");
        logInfo("You can use a TrustSet transaction to change the No Ripple setting of a trust line to match your address's new default.");

        // Section 2: Authorized Trust Lines
        logSectionHeader("Authorized Trust Lines");

        logInfo("This setting (also called 'asfRequireAuth') limits your tokens to being held only by accounts you've explicitly approved.");
        logWarning("You cannot enable this setting if you already have any trust lines or offers for any token.");
        logError("Note: To use authorized trust lines, you must perform additional steps that are not shown in this tutorial.");

        console.log("\n#######################################################################\n");

        // Set or clear account flags for issuer
        if (readlineSync.keyInYN('Do you want to set or clear any account flags for the issuer?')) {
            const setFlagNames = selectFlags('Select the flags to set');
            const clearFlagNames = selectFlags('Select the flags to clear');

            let setFlags = setFlagNames ? setFlagNames.map(name => getFlagValue(name)) : [];
            let clearFlags = clearFlagNames ? clearFlagNames.map(name => getFlagValue(name)) : [];

            if (setFlags.length > 0 || clearFlags.length > 0) {
                const results = await setAccountFlags(client, issuerWallet, setFlags, clearFlags);
                // console.log('Account flags updated for issuer. Results:', JSON.stringify(results, null, 2));
            } else {
                console.log('No flags were set or cleared.');
            }
        }

        const currencyCode = readlineSync.question('Enter the currency code for the new token (3-6 characters): ');
        const amountToIssue = readlineSync.question('Enter the amount of the token to issue: ');
        let trustLineLimit = readlineSync.question('Enter the trust line limit (optional, default is 1000000000): ');

        // Set default value if input is empty
        if (!trustLineLimit) {
            trustLineLimit = "1000000000"; // Default limit value
        }

        console.log("Setting trust line...");
        await setTrustLine(client, currencyCode, issuerWallet.classicAddress, receiverWallet, trustLineLimit);
        console.log("Trust line set successfully.");

        console.log("Issuing tokens...");
        await issueToken(client, currencyCode, issuerWallet, receiverWallet.classicAddress, amountToIssue);
        console.log(`${amountToIssue} ${currencyCode} tokens issued successfully.`);

        // Black hole issuer address
        if (readlineSync.keyInYN('Do you want to black hole the issuer address?')) {
            await blackHoleIssuer(client, issuerWallet);
            console.log('Issuer address has been black holed.');
        }

        client.disconnect();
    } catch (error) {
        console.error("An error occurred:", error);
    } finally {
        if (client) {
            client.disconnect();
        }
    }
}

main();
