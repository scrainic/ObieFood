/**
    Copyright 2014-2015 Amazon.com, Inc. or its affiliates. All Rights Reserved.

    Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance with the License. A copy of the License is located at

        http://aws.amazon.com/apache2.0/

    or in the "license" file accompanying this file. This file is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
*/

/**
 * This sample shows how to create a Lambda function for handling Alexa Skill requests that:
 * - Web service: communicate with an external web service to get menu data from MENU JSONs
 * - Multiple optional slots: has 2 slots (menu and date), where the user can provide 0, 1, or 2 values, and assumes defaults for the unprovided values
 * - DATE slot: demonstrates date handling and formatted date responses appropriate for speech
 * - Custom slot type: demonstrates using custom slot types to handle a finite set of known values
 * - Dialog and Session menu: Handles two models, both a one-shot ask and tell model, and a multi-turn dialog model.
 *   If the user provides an incorrect slot in a one-shot model, it will direct to the dialog model. 
 *
 */

/**
 * App ID for the skill
 */
var APP_ID = process.env.APP_ID;
if (!APP_ID) {
//    var APP_ID = "amzn1.ask.skill.1922d22e-8c2d-46ee-b0a3-4331c1db2f1b"; // scrainic
//    var APP_ID = "amzn1.ask.skill.a71e43c2-1ccf-470c-8210-ddca34ec6351"; // jcrainic
}

var http = require('http'),
    alexaDateUtil = require('./alexaDateUtil');

var storage = require('./storage');

/**
 * The AlexaSkill prototype and helper functions
 */
var AlexaSkill = require('./AlexaSkill');

/**
 * MenuFinder is a child of AlexaSkill.
 * To read more about inheritance in JavaScript, see the link below.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Introduction_to_Object-Oriented_JavaScript#Inheritance
 */
var MenuFinder = function () {
    AlexaSkill.call(this, APP_ID);
};

// Extend AlexaSkill
MenuFinder.prototype = Object.create(AlexaSkill.prototype);
MenuFinder.prototype.constructor = MenuFinder;

// ----------------------- Override AlexaSkill request and intent handlers -----------------------

MenuFinder.prototype.eventHandlers.onSessionStarted = function (sessionStartedRequest, session) {
    console.log("onSessionStarted requestId: " + sessionStartedRequest.requestId
        + ", sessionId: " + session.sessionId + " APP_ID="+APP_ID);
    if (session.user.userId) {
            console.log("gettingData");
            session.attributes.gettingData = true;
            storage.getData(session.user.userId, function (data)
            {
                    console.log("done gettingData: "+JSON.stringify(data));
                    session.attributes.gettingData = false;
                    if (data && data.Item && data.Item.Data && data.Item.Data.S) {
                        try {
                            session.attributes.data = JSON.parse(data.Item.Data.S);
                            console.log("data="+session.attributes.data.S);
                        } catch(e)
                        {
                            console.log("JSON parse:"+data + " >> error: "+e);
                        }
                    }
                    if (session.attributes.dataCallback)
                        session.attributes.dataCallback();
            });
            setTimeout(function() {
                console.log("Canceled gettingData");
                session.attributes.gettingData = false;
                }, 2000);
    }
};

MenuFinder.prototype.eventHandlers.onLaunch = function (launchRequest, session, response) {
    console.log("onLaunch requestId: " + launchRequest.requestId + ", sessionId: " + session.sessionId);
    handleWelcomeRequest(response);
};

MenuFinder.prototype.eventHandlers.onSessionEnded = function (sessionEndedRequest, session) {
    console.log("onSessionEnded requestId: " + sessionEndedRequest.requestId
        + ", sessionId: " + session.sessionId);
    // any cleanup logic goes here
};

/**
 * override intentHandlers to map intent handling functions.
 */
MenuFinder.prototype.intentHandlers = {
    "OneshotMenuIntent": function (intent, session, response) {
            console.log("OneshotMenuIntent "+session.attributes.gettingData);
            if (session.attributes.gettingData) {
                var callback = function () {
                    handleOneshotMenuRequest(intent, session, response);
                };
                session.attributes.dataCallback = callback;
            } else{
                handleOneshotMenuRequest(intent, session, response);
            }
    },

    "OneshotComplimentIntent": function (intent, session, response) {
        handleComplimentRequest(intent, session, response);
    },

    "OneshotRestrictionIntent": function (intent, session, response) {
        handleRestrictionRequest(intent, session, response);
    },

    "OneshotRemoveRestrictionIntent": function (intent, session, response) {
        handleRestrictionRequest(intent, session, response, true);
    },

    "DialogMenuIntent": function (intent, session, response) {
        // Determine if this turn is for menu, for date, or an error.
        // We could be passed slots with values, no slots, slots with no value.
        var menuSlot = intent.slots.Menu;
        var dateSlot = intent.slots.Date;
        if (menuSlot && menuSlot.value) {
            handleMenuDialogRequest(intent, session, response);
        } else if (dateSlot && dateSlot.value) {
            handleDateDialogRequest(intent, session, response);
        } else {
            handleNoSlotDialogRequest(intent, session, response);
        }
    },

    "SupportedMenusIntent": function (intent, session, response) {
        handleSupportedMenusRequest(intent, session, response);
    },

    "AMAZON.HelpIntent": function (intent, session, response) {
        handleHelpRequest(response);
    },

    "AMAZON.RepeatIntent": function (intent, session, response) {
        handleRepeatRequest(response, session);
    },

    "AMAZON.StopIntent": function (intent, session, response) {
        speechOutput = {
            speech:  "<speak>Goodbye and <phoneme alphabet=\"ipa\" ph=\"ˌboʊn ˌæpəˈti\">bon appétit</phoneme>.</speak>",
            type: AlexaSkill.speechOutputType.SSML
        },
        response.tell(speechOutput);
    },

    "AMAZON.CancelIntent": function (intent, session, response) {
        var speechOutput = "Goodbye";
        response.tell(speechOutput);
    }
};

// -------------------------- MenuFinder Domain Specific Business Logic --------------------------

var MENUS = {
    'vegan': 1,
    'vegetarian': 1,
    'glutenfree': 1,
    'no restrictions': 1,
    'full': 1,
};

function handleWelcomeRequest(response) {
    var whichMenuPrompt = "For which meal would you like the menu?",
        speechOutput = {
            speech: "<speak>Welcome to Obie food. "
                + whichMenuPrompt
                + "</speak>",
            type: AlexaSkill.speechOutputType.SSML
        },
        repromptOutput = {
            speech: "I can tell you the menu specials at campus halls and cafés. You can ask for a specific date and you can also ask for vegan, vegetarian or gluten-free only."
                + whichMenuPrompt,
            type: AlexaSkill.speechOutputType.PLAIN_TEXT
        };

    response.ask(speechOutput, repromptOutput);
}

function handleHelpRequest(response) {
    var repromptText = "For which meal would you like the menu?";
    var speechOutput = "Say lunch or dinner and a date to hear the menu special on campus. You can include dietary restrictions like vegan, vegetarian and gluten-free by saying for example: vegetarian menu. You can also say: I'm vegetarian (or vegan or gluten intolerant) if you'd like me to also remember your dietary restriction."
        + "Or you can say exit. "
        + repromptText;

    response.ask(speechOutput, repromptText);
}

function handleRepeatRequest(response, session) {
    var speechOutput = session.attributes ? session.attributes.spoken : null;
    if (speechOutput) {
        response.ask(speechOutput, "What else would you like to know?");
        return;
    }

    var repromptText = "For which meal would you like the menu?";
    var speechOutput = "Sorry, I have nothing to repeat." + repromptText;
    response.ask(speechOutput, repromptText);
}

/**
 * Handles the case where the user asked or for, or is otherwise being with supported menus
 */
function handleSupportedMenusRequest(intent, session, response) {
    // get menu re-prompt
    var repromptText = "For which meal would you like information?";
    var speechOutput = "Currently, I know menu information for: "
                       + getAllMenusText()
                       + repromptText;

    response.ask(speechOutput, repromptText);
}

/**
 * Handles the dialog step where the user provides a menu
 */
function handleMenuDialogRequest(intent, session, response) {

    var menu = getMenuFromIntent(intent, false),
        repromptText,
        speechOutput;
    if (!menu) {
        repromptText = "Currently, I know menu information for these menus: " + getAllMenusText()
            + "Which menu would you like menu information for?";
        // if we received a value for the incorrect menu, repeat it to the user, otherwise we received an empty slot
        speechOutput = menu ? "I'm sorry, I don't have any data for " + menu + ". " + repromptText : repromptText;
        response.ask(speechOutput, repromptText);
        return;
    }

    // if we don't have a date yet, go to date. If we have a date, we perform the final request
    if (session.attributes.date) {
        getFinalMenuResponse(menu, session.attributes.date, null, null, session, response);
    } else {
        // set menu in session and prompt for date
        session.attributes.menu = menu;
        speechOutput = "For which date?";
        repromptText = "For which date would you like menu information for " + menu.menu + "?";

        response.ask(speechOutput, repromptText);
    }
}

/**
 * Handles the dialog step where the user provides a date
 */
function handleDateDialogRequest(intent, session, response) {

    var date = getDateFromIntent(intent),
        repromptText,
        speechOutput;
    if (!date) {
        repromptText = "Please try again saying a day of the week, for example, Saturday. "
            + "For which date would you like menu information?";
        speechOutput = "I'm sorry, I didn't understand that date. " + repromptText;

        response.ask(speechOutput, repromptText);
        return;
    }

    // if we don't have a menu yet, go to menu. If we have a menu, we perform the final request
    if (session.attributes.menu) {
        getFinalMenuResponse(session.attributes.menu, date, null, null, session, response);
    } else {
        // The user provided a date out of turn. Set date in session and prompt for menu
        session.attributes.date = date;
        speechOutput = "For which menu would you like menu information for " + date.displayDate + "?";
        repromptText = "For which menu?";

        response.ask(speechOutput, repromptText);
    }
}

/**
 * Handle no slots, or slot(s) with no values.
 * In the case of a dialog based skill with multiple slots,
 * when passed a slot with no value, we cannot have confidence
 * it is the correct slot type so we rely on session menu to
 * determine the next turn in the dialog, and reprompt.
 */
function handleNoSlotDialogRequest(intent, session, response) {
    if (session.attributes.menu) {
        // get date re-prompt
        var repromptText = "Please try again saying a day of the week, for example, Saturday. ";
        var speechOutput = repromptText;

        response.ask(speechOutput, repromptText);
    } else {
        // get menu re-prompt
        handleSupportedMenusRequest(intent, session, response);
    }
}

/**
 * Handles restriction
 */
function handleRestrictionRequest(intent, session, response, remove) {
        var restrictionValue = "";
        try {
            restrictionValue = intent.slots.Restriction.value;
        } catch (e)
        {
        }
        var restriction;
        if (restrictionValue) {
            restriction = restrictionValue.toLowerCase().replace(/[^a-z]/g, "");
console.log("          restriction='"+restriction + "'");  
            switch (restriction) {
            case "vegetarian":
            case "vegan":
            case "glutenfree":
                break;
            case "glutenintolerant":
                restriction = "glutenfree";
                break;
            default:
                restriction = null;
                break;
            }
        }
        if (restriction) {
            var data = remove ? null: {"restriction": restriction};
            session.attributes.data = data;
            storage.setData(session.user.userId, data, function (error)
            {
                var speechOutput;
                if (error) {
                    speechOutput = "Sorry, I'm having trouble saving your dietary restriction. Please try again later. In the meantime, you can ask directly, like: "+restriction +" dinner.";
                } else {
                    if (remove) {
                        speechOutput = "OK. From now on I will tell you the full menu, with no restrictions.";
                        console.log("remove restriction");
                    } else {
                        speechOutput = "OK. From now on I will remember that you only want to hear the "+ restriction + " menu. If you want me to forget that, say: I'm not " +restrictionValue + ".";
                        console.log("set restriction: "+restriction);
                    }
                }
                response.ask(speechOutput, "What else can I do for you ?");
            });
            return;
        } 

        var speechOutput = "Sorry I didn't quite understand your dietary restriction. Can you please repeat that?";
        response.ask(speechOutput, "What else can I do for you ?");
}

/**
/**
 * Handles compliments (Easter egg)
 */
function handleComplimentRequest(intent, session, response) {
        var compliment = "";
        try {
                compliment = intent.slots.Compliment.value;
        } catch (e)
        {
        }
        if (compliment) {
            compliment = compliment.toLowerCase().replace(/[^a-z]/g, "");
            if (compliment.indexOf("cool") >= 0)
                    compliment = "cool";
        }

        switch (compliment) {
        case "ilovethis":
        case "ilikethis":
                var speechOutput = "I'm flattered! Love is quite a strong word.";
                break;
        case "thisisverycool":
        case "thisissocool":
        case "thisisbrilliant":
        case "thisiscool":
        case "wow":
                var speechOutput = "I find myself pretty cool too.";
                break;
        case "youvegottoseethis":
        case "comeseethis":
                var speechOutput = "Yes, let's wait for everybody to get settled in.";
                break;
        case "comecheckthisout":
        case "checkthisout":
        case "comeseethis":
                var speechOutput = "But I don't like when people check me out.";
                break;
            break;

        default:
            response.ask("Could you please repeat that?", "What other meal would you like to find out about?");
            return;
        }
        if (speechOutput)
                speechOutput = "Thank you! " + speechOutput + " But seriously, what would you like me to do?";
        else
                speechOutput = "Sorry I didn't quite understand that. What would you like me to do?";
        response.ask(speechOutput, "What else can I do for you ?");
}

/**
 * This handles the one-shot interaction, where the user utters a phrase like:
 * 'Alexa, open Obie menu and get menu information for Stevie on Saturday'.
 * If there is an error in a slot, this will guide the user to the dialog approach.
 */
function handleOneshotMenuRequest(intent, session, response) {
    // Determine menu, using default if none provided
    var cafe = getCafeFromIntent(intent);
    // Determine custom date
    var date = getDateFromIntent(intent);
    // Determine meal date
    var meal = getMealFromIntent(intent);
    if (meal) {
        switch (meal) {
            case "lunch":
            case "dinner":
                break;
            default:
                var repromptText = "Please try again.";
                var speechOutput = "Sorry, I only know the menu for lunch and dinner.";
                response.ask(speechOutput, repromptText);
                return;
        }
    }

    // Determine meal restriction
    var restriction = getRestrictionFromIntent(intent);
    if (restriction) {
        switch (restriction.toLowerCase().replace(/\s/g, "")) {
            case "full":
            case "norestrictions":
                restriction = "-";
                break;
            case "glutenfree":
            case "vegan":
            case "vegetarian":
                break;
            default:
                var repromptText = "Please try again. ";
                var speechOutput = "Sorry, I only know the dietary restrictions for vegan, vegetarian and gluten-free.";
                response.ask(speechOutput, repromptText);
                return;
        }
    } else {
            restriction = session && session.attributes && session.attributes.data ? session.attributes.data.restriction : null;
    }
    console.log(restriction + " | "+meal + " | "+date)
    if (!restriction && !meal) {
        if (!intent.slots || !intent.slots.Date || !intent.slots.Date.value) {
            response.ask("Could you please repeat that?", "What other meal would you like to find out about?");
            return;
        }
    }
    // all slots filled, either from the user or by default values. Move to final request
    getFinalMenuResponse(cafe, date, meal, restriction, session, response);
}

/**
 * Both the one-shot and dialog based paths lead to this method to issue the request, and
 * respond to the user with the final answer.
 */
function getFinalMenuResponse(cafe, date, meal, restriction, session, response) {

    if (meal == "breakfast") {
            var repromptText = "Please try again saying. ";
            var speechOutput = "Sorry, I only know the menu for lunch and dinner.";

            response.ask(speechOutput, repromptText);
    }
    // Issue the request, and respond to the user
    makeMenuRequest(cafe, date, meal, restriction, function menuResponseCallback(err, menuResponse, meal2, restriction2) {
        var speechOutput;

        var filter;
        var filter2 = "";
        var spokenRestriction = restriction2;
        if (restriction2) {
            switch(restriction2.toLowerCase().replace(/\s/g, "")) {
            case "vegan":
                filter = 4;
                break;
            case "vegetarian":
                filter = 1;
                filter2 = 4;
                break;
            case "glutenfree":
                spokenRestriction = "gluten-free";
                filter = 9;
                break;
            default:
                filter = 0;
                break;
            }
            if (filter > 0)
                meal2 = spokenRestriction + " "+meal2;
        }

        var cardOutput;
        if (err) {
            speechOutput = "Sorry, I can't find information for "+meal2 + " for " +date.displayDate + ". Please try again later.";
        } else {
            var cardSpeech = "";
            var itemsSpeech = "";
            var allItems = [];
            for (var cafe in menuResponse) {
                var s = "";
                var scard = "";
                var items = menuResponse[cafe];
                for (var i = 0; i < items.length; i++) {
                    item = items[i];
                    if (filter > 0) {
                        if (!item.iconvalue)
                            continue;
                        if (item.iconvalue.indexOf(filter) < 0 && (!filter2 || item.iconvalue.indexOf(filter2) < 0))
                            continue;
                    }
                    var label = item.label;
                    if (!label || label.toLowerCase() == "closed")
                        continue;
                    label = label.replace("(upon request)","");
                    if (allItems.indexOf(label) < 0) {
                        if (s) {
                            s += ", ";
                            scard += ", ";
                        }
                        s += label;
                        scard += label;
                        if (item.icon)
                            scard += " ("+item.icon+")";
                        allItems.push(label);
                    }
                }
                if (s) {
                    itemsSpeech += cafe + ": " + s + ". ";
                }
                if (scard) {
                    cardSpeech += cafe + ": " + scard + ".\n";
                }
            }
            if (itemsSpeech) {
                speechOutput = meal2 + " " +date.displayDate + " : " + itemsSpeech;
                cardOutput = cardSpeech;
            } else {
                speechOutput = "I couldn't find information for " +meal2 + " for " +date.displayDate + " .";
            }
        }
        var reprompt = "What else would you like to know?";
        session.attributes.spoken = speechOutput;
        response.askWithCard(speechOutput, reprompt, meal2 + " " +date.displayDate, cardOutput || speechOutput);
    });
}

function makeMenuRequest(cafe, date, meal, restriction, menuResponseCallback) {
    var now = new Date();
    console.log("meal: "+meal + " "+now.getHours() + " " +now.getTimezoneOffset());
    var h = now.getHours() - 5 + (now.getTimezoneOffset()/60);
    if (!meal) {
        meal = h < 15 ? "lunch" : "dinner";
    }
    if (meal == "lunch" && h > 17) {
        now.setDate(now.getDate() + 1);
    }
            
    var endpoint = 'http://scrtest1.blob.core.windows.net/obfood/'+ date.requestDateParam + "/" + meal + ".json";
    console.log("menu: "+endpoint + " "+now.getHours());
    http.get(endpoint, function (res) {
        var menuResponseString = '';
        console.log('Status Code: ' + res.statusCode);

        if (res.statusCode != 200) {
            menuResponseCallback(new Error("Non 200 Response"), meal, restriction);
        }

        res.on('data', function (data) {
            menuResponseString += data;
        });

        res.on('end', function () {
            try {
                var menuResponseObject = JSON.parse(menuResponseString);
            } catch (e)
            {
                console.log("MENU error: " + e + ": "+menuResponseString);
            }

            if (!menuResponseObject) {
                menuResponseCallback(new Error("JSON parse"), meal, restriction);
            } else {
                menuResponseCallback(null, menuResponseObject, meal, restriction);
            }
        });
    }).on('error', function (e) {
        console.log("Communications error: " + e.message);
        menuResponseCallback(new Error(e.message), meal, restriction);
    });
}

/**
 * Gets the cafe from the intent, or returns an error
 */
function getCafeFromIntent(intent) {
    if (!intent || !intent.slots || !intent.slots.Cafe)
        return null;
    var slot = intent.slots.Cafe;
    return slot.value;
}

function getMealFromIntent(intent) {
    if (!intent || !intent.slots || !intent.slots.Meal)
        return null;
    var slot = intent.slots.Meal;
    return slot.value == "launch" ? "lunch" : slot.value;
}

function getRestrictionFromIntent(intent) {
    if (!intent || !intent.slots || !intent.slots.Restriction)
        return null;
    var slot = intent.slots.Restriction;
    return slot.value;
}

/**
 * Gets the date from the intent, defaulting to today if none provided,
 * or returns an error
 */
function getDateFromIntent(intent) {

    var dateSlot = intent && intent.slots ? intent.slots.Date : null;
    // slots can be missing, or slots can be provided but with empty value.
    // must test for both.
    var displayDate;
    var date;
    var now = new Date();
    if (!dateSlot || !dateSlot.value) {
        // default to today
        date = now;
        displayDate = "Today";
    } else {
        date = new Date(dateSlot.value);
        if (date - now > 6 * 30.5 * 24 *3600000)
            date.setFullYear(date.getFullYear() - 1);
        displayDate = alexaDateUtil.getFormattedDate(date);
    }
    // format the request date like YYYY-MM-DD
    var month = (date.getMonth() + 1);
    month = month < 10 ? '0' + month : month;
    var dayOfMonth = date.getDate();
    dayOfMonth = dayOfMonth < 10 ? '0' + dayOfMonth : dayOfMonth;
    var requestDay = date.getFullYear() +"/"+ month + "/" +dayOfMonth;

    return {
        displayDate: displayDate,
        requestDateParam: requestDay
    }
}

function getAllMenusText() {
    var s = '';
    for (var i in MENUS) {
        s += i + ", ";
    }

    return s;
}

// Create the handler that responds to the Alexa Request.
exports.handler = function (event, context) {
    var menuFinder = new MenuFinder();
    menuFinder.execute(event, context);
};


var icons = {
            1: "http://legacy.cafebonappetit.com/assets/cor_icons/menu-item-type-c9d18b.png",
            3: "http://legacy.cafebonappetit.com/assets/cor_icons/menu-item-type-43c4b7.png",
            4: "http://legacy.cafebonappetit.com/assets/cor_icons/menu-item-type-668e3c.png",
            6: "http://legacy.cafebonappetit.com/assets/cor_icons/menu-item-type-d58f59.png",
            7: "http://legacy.cafebonappetit.com/assets/cor_icons/menu-item-type-inbalance.png",
            9: "http://legacy.cafebonappetit.com/assets/cor_icons/menu-item-type-ce9d00.png",
};
