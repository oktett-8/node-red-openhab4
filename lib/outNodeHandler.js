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

const { STATE } = require('./constants');

/** OutNode class for handling outgoing OpenHAB commands */
class OutNodeHandler extends ConsumerNodeHandler {
    setupNodeLogic() {
        this.enableInputHandling();
    }

    /** Override to handle input messages. It will prepare a message for OpenHAB, and send it to OpenHAB.
     * If the send is successful, it will update the node status and send the original message out. */
    async handleInput(msg) {
        let item = this.getResource(msg);
        if (!item) {
            this.setStatus(STATE.ERROR, 'found no item');
            this.node.error('no item found - check node configuration or msg.topic', msg);
            return;
        }

        if (!msg.action && !this.config.action) {
            this.setStatus(STATE.ERROR, 'no action specified');
            this.node.error('no action specified - set action in node configuration or msg.action', msg);
            return;
        }

        const action = this.prioritizedProperty(msg.action, this.config.action).trim().toLowerCase();
        const payload = this._normalizePayload(this.prioritizedProperty(msg.payload, this.config.payload));

        this.setStatus(STATE.WORKING, `${payload} ⇨`);
        const result = await this.controller.handler.control(item, action, payload);
        if (result.ok) {
            this.setValueStatus(`${payload} ✓`);
            const message = {
                ...msg, // copy all properties from the original message, so we preserve any custom properties that the user might have added.
                ...result.data, // add properties from the result data
                topic: item.topic(), // override topic with the one actually used
                identifier: item.identifier,
                payload,
                action,
                input: msg,
            };

            const outMsg = this.createMessage({ message });
            this.node.send(outMsg);
        } else {
            // send failed - set error status regardless of whether it's transient or permanent
            this.setStatus(STATE.ERROR, `${payload} ✗ ${item.identifier}`);

            if (!result.retry) {
                // permanent error - wrong item name, auth failure etc. - user needs to act
                const errorMessage = result.message ?? result.code ?? 'send failed';
                this.node.error(`${errorMessage} (${item.identifier})`, msg);
            }
        }
    }

    // --- Private methods ---

    _normalizePayload(payload) {
        // make buffers safe
        if (Buffer.isBuffer(payload)) {
            return payload.toString('utf8');
        }

        if (typeof payload === 'number' || typeof payload === 'boolean') {
            return String(payload);
        }
        // leave plain objects intact, httpRequest makes JSON out of that.
        return payload;
    }
}

/** Entry point to create and setup the OutNode. Called by the out node registration. */
function setupOutNodeHandler(node, config, controller) {
    return new OutNodeHandler(node, config, controller).setupNode();
}

module.exports = { OutNodeHandler, setupOutNodeHandler };
