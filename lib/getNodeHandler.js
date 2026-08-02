// Copyright 2025-2026 Rik Essenius
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software distributed under the License is
// distributed on an "AS IS" BASIS WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.

'use strict';

const { ConsumerNodeHandler } = require('./consumerNodeHandler');
const { ACTION, STATE, EVENT_TAG } = require('./constants');

/** GetNode class for handling OpenHAB item retrieval */
class GetNodeHandler extends ConsumerNodeHandler {
    setupNodeLogic() {
        this.enableInputHandling();
    }

    /** Override to handle input messages. It will prepare a message for OpenHAB, send it out, and wait for the response. */
    async handleInput(msg) {
        let resource = this.getResource(msg);

        if (!resource) {
            this.setStatus(STATE.ERROR, 'no resource found');
            this.node.error('no resource found - check node configuration or msg.topic', msg);
            return;
        }

        this.setStatus(STATE.WAITING, 'requesting...');
        const response = await this.controller.handler.control(resource, ACTION.GET);
        this._handleGetResponse(msg, response);
    }

    // --- Private methods ---

    /** Parse the response from OpenHAB, convert it to a message, and send that out.
     * If an error occurs, set the node status to error and log the error message. */
    _handleGetResponse(request, response) {
        if (!response.ok) {
            this.setStatus(STATE.ERROR, response.code ?? 'request failed');
            this.controller.handler.eventBus.publish(EVENT_TAG.GLOBAL_ERROR, {
                context: { node: this.node.name, ...request },
                payload: response,
            });
            if (!response.retry) {
                // permanent error - wrong resource name, auth failure etc. - user needs to act
                this.node.error(response.message ?? response.code ?? 'request failed', request);
            }
            return;
        }
        if (!response.data) {
            // unexpected empty response - not a connectivity issue, user needs to investigate
            this.setStatus(STATE.ERROR, response.message ?? 'empty response');
            this.node.error(response.message ?? 'empty response', request);
            return;
        }

        const message = {
            ...request,
            ...response.data,
            input: request,
        };

        this.setValueStatus(message.payload);

        const outMsg = this.createMessage({ message });
        this.node.send(outMsg);
    }
}

/** Entry point to create and setup the GetNode. Called by the get node registration. */
function setupGetNodeHandler(node, config, controller) {
    return new GetNodeHandler(node, config, controller).setupNode();
}

module.exports = { GetNodeHandler, setupGetNodeHandler };
