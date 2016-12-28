/**
    Copyright 2014-2015 Amazon.com, Inc. or its affiliates. All Rights Reserved.

    Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance with the License. A copy of the License is located at

        http://aws.amazon.com/apache2.0/

    or in the "license" file accompanying this file. This file is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
*/

'use strict';
var AWS = require("aws-sdk");

var storage = (function () {
    var dynamodb = new AWS.DynamoDB({apiVersion: '2012-08-10'});
    return {
    setData: function(userId, data, callback) {
            console.log("setData: " + userId + "="+JSON.stringify(data));
            dynamodb.putItem({
                TableName: 'obfood-userdata',
                Item: {
                    CustomerId: {
                        S: userId
                    },
                    Data: {
                        S: JSON.stringify(data)
                    }
                }
            }, function (err, data) {
                if (err) {
                    console.log(err, err.stack);
                }
                if (callback) {
                    callback(err);
                }
            });
    },

       getData: function (userId, callback) {
            dynamodb.getItem({
                TableName: 'obfood-userdata',
                Key: {
                    CustomerId: {
                        S: userId
                    }
                }
            }, function (err, data) {
                if (err) {
                    console.log(err, err.stack);
                    callback(null);
                } else {
                    console.log('get data from dynamodb=' + data);
                    callback(data);
                }
            });
        }
    };
})();
module.exports = storage;

