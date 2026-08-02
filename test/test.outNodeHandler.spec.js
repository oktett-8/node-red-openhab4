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

const path = require('node:path');
const { expect } = require('chai');
const sinon = require('sinon');
const outNodeHandlerPath = path.join(__dirname, '..', 'lib', 'outNodeHandler.js');
const { OutNodeHandler } = require(outNodeHandlerPath);

function createOutNodeHandler({ controlResult = { ok: true, payload: {} }, config = {}, time = '12:34:56' } = {}) {
    const node = {
        type: 'openhab4-out',
        status: sinon.spy(),
        on: sinon.spy(),
        send: sinon.spy(),
        log: sinon.spy(),
        error: sinon.spy(),
    };
    const controllerHandler = { control: sinon.stub().resolves(controlResult) };
    const controller = { handler: controllerHandler };
    const outNodeHandler = new OutNodeHandler(node, config, controller, { generateTime: () => time });
    return { outNodeHandler, node, controller };
}

describe('outNodeHandler', function () {
    it('should set state on successful send', async function () {
        const { outNodeHandler, node } = createOutNodeHandler({ config: { action: 'command' } });
        const msg = { topic: 'items/test', payload: 1234 };
        await outNodeHandler.handleInput(msg);
        expect(node.status.getCall(0).args[0]).to.deep.equal(
            { fill: 'blue', shape: 'dot', text: '[12:34:56] 1234 ⇨' },
            'status sending called'
        );
        expect(node.status.getCall(1).args[0]).to.deep.equal(
            { fill: 'green', shape: 'dot', text: '[12:34:56] 1234 ✓' },
            'status sent called'
        );

        // should be a separate test, but that seems too much overhead
        expect(outNodeHandler.getNodeType(), 'node type is Out').to.equal('Out');
    });

    it('should ignore identifier if topic is set', async function () {
        const { outNodeHandler, node } = createOutNodeHandler({ config: { concept: 'items', action: 'command' } });
        const msg = { topic: 'test1', identifier: 'test2', payload: 'test' };

        await outNodeHandler.handleInput(msg);

        expect(node.send.firstCall.args[0], 'send called').to.deep.include({
            topic: 'items/test1',
            identifier: 'test1',
            payload: 'test',
            action: 'command',
            input: {
                topic: 'test1',
                identifier: 'test2',
                payload: 'test',
            },
        });
    });

    const configErrorCases = [
        {
            desc: 'undefined items',
            config: { concept: 'items', action: 'command' },
            expectedStatus: 'found no item',
        },
        {
            desc: 'undefined actions',
            config: { concept: 'items/item1' },
            expectedStatus: 'no action specified',
        },
    ];

    for (const { desc, config, expectedStatus } of configErrorCases) {
        it(`should set state and call node.error with handleInput on ${desc}`, async function () {
            const { outNodeHandler, node } = createOutNodeHandler({ config });
            const msg = { payload: 'test' };

            await outNodeHandler.handleInput(msg);

            expect(node.status.firstCall.args, 'status called').to.deep.equal([
                { fill: 'red', shape: 'ring', text: `[12:34:56] ${expectedStatus}` },
            ]);
            expect(node.error.calledOnce, 'node.error called').to.be.true;
            expect(node.error.firstCall.args[1]).to.equal(msg, 'original msg passed to node.error');
        });
    }

    it('should show an error and call node.error if control fails permanently', async function () {
        const { outNodeHandler, node } = createOutNodeHandler({
            controlResult: { ok: false, retry: false, message: 'Simulated error' },
            config: {
                concept: 'items',
                identifier: 'testItem',
                action: 'update',
                payload: 'testPayload',
                priority: 'message',
            },
        });

        const msg = { payload: 'test' }; // should override config

        await outNodeHandler.handleInput(msg);
        expect(node.status.secondCall.args, 'status called').to.deep.equal([
            { fill: 'red', shape: 'ring', text: '[12:34:56] test ✗ testItem' },
        ]);
        expect(node.error.calledOnce, 'node.error called for permanent failure').to.be.true;
        expect(node.error.firstCall.args[0]).to.include('Simulated error', 'error message included');
        expect(node.error.firstCall.args[0]).to.include('testItem', 'item name included');
        expect(node.error.firstCall.args[1]).to.equal(msg, 'original msg passed to node.error');
    });

    it('should show an error status but not call node.error if control fails transiently', async function () {
        const { outNodeHandler, node } = createOutNodeHandler({
            controlResult: { ok: false, retry: true, message: 'OpenHAB offline' },
            config: {
                concept: 'items',
                identifier: 'testItem',
                action: 'update',
            },
        });

        const msg = { payload: 'test' };

        await outNodeHandler.handleInput(msg);
        expect(node.status.secondCall.args, 'status called').to.deep.equal([
            { fill: 'red', shape: 'ring', text: '[12:34:56] test ✗ testItem' },
        ]);
        expect(node.error.notCalled, 'node.error not called for transient failure').to.be.true;
    });

    it('should convert a buffer to utf8', async function () {
        const payload = Buffer.from([65, 66, 67, 68]);
        const { outNodeHandler, node } = createOutNodeHandler({
            config: {
                concept: 'items',
                identifier: 'testItem',
                action: 'update',
                payload: null,
                priority: 'message',
            },
        });

        const msg = { payload };

        await outNodeHandler.handleInput(msg);
        expect(node.status.getCall(0).args[0]).to.deep.equal(
            { fill: 'blue', shape: 'dot', text: '[12:34:56] ABCD ⇨' },
            'status sending called'
        );
    });
});
