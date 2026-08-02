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
const getNodeHandlerPath = path.join(__dirname, '..', 'lib', 'getNodeHandler.js');
const { GetNodeHandler } = require(getNodeHandlerPath);

function createGetNodeHandler({ controlResult = { ok: true, data: {} }, config = {}, time = '12:34:56' } = {}) {
    const node = {
        status: sinon.spy(),
        send: sinon.spy(),
        on: sinon.spy(),
        log: sinon.spy(),
        error: sinon.spy(),
        name: 'test-node',
    };
    let controller;
    if (controlResult === null) {
        controller = null;
    } else {
        const eventBus = { publish: sinon.spy(), subscribe: sinon.spy() };
        const controllerHandler = { control: sinon.stub().resolves(controlResult), eventBus };
        controller = { handler: controllerHandler, handleControllerError: sinon.spy() };
    }
    const utils = { generateTime: () => time, generateId: () => '123' };
    const getNodeHandler = new GetNodeHandler(node, config, controller, utils);
    getNodeHandler.setupNode();
    return { getNodeHandler, node, controller };
}

async function expectHandleInputResult(getNodeHandler, msg, node) {
    await getNodeHandler.handleInput(msg);
    expect(node.status.getCall(2).args[0], 'requesting status called').to.deep.equal({
        fill: 'blue',
        shape: 'ring',
        text: 'requesting... @ 12:34:56',
    });
    expect(node.status.getCall(3).args[0], 'item status called').to.deep.equal({
        fill: 'green',
        shape: 'dot',
        text: 'ON @ 12:34:56',
    });
    expect(node.send.getCall(0).args[0], 'item status sent').to.deep.include({
        input: msg,
        payload: 'ON',
        topic: 'items/testItem',
    });
}

function assertRequestingStatus(node) {
    expect(node.status.getCall(2).args[0], 'requesting status called').to.deep.equal({
        fill: 'blue',
        shape: 'ring',
        text: '[12:34:56] requesting...',
    });
}

function assertErrorStatus(node, errorText) {
    expect(node.status.getCall(3).args[0], 'Error shown').to.deep.equal({
        fill: 'red',
        shape: 'ring',
        text: `[12:34:56] ${errorText}`,
    });
}

describe('getNodeHandler handleInput', function () {
    it('should show version info if concept system is specified', async function () {
        const { node, getNodeHandler } = createGetNodeHandler({
            controlResult: { ok: true, data: { payload: '4.3.5' } },
        });
        expect(node.on.getCall(0).args[0], 'Close handler registered').to.equal('close');
        expect(node.on.getCall(1).args[0], 'Input handler registered').to.equal('input');
        expect(node.status.getCall(0).args[0], 'initializing status called').to.deep.equal({
            fill: 'grey',
            shape: 'ring',
            text: '[12:34:56] initializing...',
        });
        expect(node.status.getCall(1).args[0], 'status cleared after init').to.deep.equal({});

        await getNodeHandler.handleInput({ topic: 'system/' });

        expect(node.status.getCall(2).args[0], 'requesting status called').to.deep.equal({
            fill: 'blue',
            shape: 'ring',
            text: '[12:34:56] requesting...',
        });
        expect(node.status.getCall(3).args[0], 'OpenHAB version shown').to.deep.equal({
            fill: 'green',
            shape: 'dot',
            text: '[12:34:56] 4.3.5',
        });
        expect(node.send.getCall(0).args[0], 'Version sent').to.deep.equal({
            //_msgid: '123',
            input: { topic: 'system/' },
            payload: '4.3.5',
            topic: 'system/',
        });
    });

    it('should deal gracefully with failed fetch (transient)', async function () {
        const { node, getNodeHandler } = createGetNodeHandler({ controlResult: { ok: false, retry: true } });

        node.status.resetHistory();
        await getNodeHandler.handleInput({ topic: 'items/testItem' });

        expect(node.status.getCall(0).args[0], 'requesting status called').to.deep.equal({
            fill: 'blue',
            shape: 'ring',
            text: '[12:34:56] requesting...',
        });
        expect(node.status.getCall(1).args[0], 'request failed').to.deep.equal({
            fill: 'red',
            shape: 'ring',
            text: '[12:34:56] request failed',
        });
        expect(node.status.calledTwice, 'Status called twice').to.be.true;
        expect(node.error.notCalled, 'node.error not called for transient failure').to.be.true;
    });

    it('should deal gracefully with failed fetch (permanent)', async function () {
        const { node, getNodeHandler } = createGetNodeHandler({
            controlResult: { ok: false, retry: false, message: 'Item does not exist', code: 'NOT_FOUND' },
        });

        node.status.resetHistory();
        const msg = { topic: 'items/testItem' };
        await getNodeHandler.handleInput(msg);

        expect(node.status.getCall(1).args[0], 'request failed status set').to.deep.equal({
            fill: 'red',
            shape: 'ring',
            text: '[12:34:56] NOT_FOUND',
        });
        expect(node.error.calledOnce, 'node.error called for permanent failure').to.be.true;
        expect(node.error.firstCall.args[0]).to.include('Item does not exist', 'error message included');
        expect(node.error.firstCall.args[1]).to.equal(msg, 'original msg passed to node.error');
    });

    it('should deal gracefully with empty response payload', async function () {
        const { node, getNodeHandler } = createGetNodeHandler({ controlResult: { ok: true } });

        node.status.resetHistory();
        const msg = { topic: 'items/testItem' };
        await getNodeHandler.handleInput(msg);

        expect(node.status.getCall(0).args[0], 'requesting status called').to.deep.equal({
            fill: 'blue',
            shape: 'ring',
            text: '[12:34:56] requesting...',
        });
        expect(node.status.getCall(1).args[0], 'Empty response reported').to.deep.equal({
            fill: 'red',
            shape: 'ring',
            text: '[12:34:56] empty response',
        });
        expect(node.status.callCount, 'Status called twice').to.equal(2);
        expect(node.error.calledOnce, 'node.error called for empty response').to.be.true;
        expect(node.error.firstCall.args[1]).to.equal(msg, 'original msg passed to node.error');
    });

    const cases = [
        {
            name: 'malformed data',
            controlResult: { ok: true, data: null },
            input: { topic: 'items/testItem', payload: 'test' },
            expectedError: 'empty response',
        },
        {
            name: 'error with message',
            controlResult: {
                ok: false,
                message: 'wrong: unknown concept',
                code: 'WRONG',
            },
            input: { topic: 'wrong/concept', payload: 'test' },
            expectedError: 'WRONG',
        },
    ];

    describe('error handling', function () {
        cases.forEach(({ name, controlResult, input, expectedError }) => {
            it(`should show an error if ${name}`, async function () {
                const { node, getNodeHandler } = createGetNodeHandler({ controlResult });

                await getNodeHandler.handleInput(input);

                assertRequestingStatus(node);
                assertErrorStatus(node, expectedError);
                expect(node.send.notCalled, 'No message sent').to.be.true;
            });
        });
    });

    it('should show waiting and then value if an item is specified', async function () {
        const { node, getNodeHandler } = createGetNodeHandler({ controlResult: { ok: true, data: { payload: 'ON' } } });
        const msg = { topic: 'items/testItem', payload: 'test' };
        expectHandleInputResult(getNodeHandler, msg, node);
    });

    it('should show waiting and then value if topic is empty and fallback is available', async function () {
        const { node, getNodeHandler } = createGetNodeHandler({
            config: { concept: 'items', identifier: 'testItem' },
            controlResult: { ok: true, data: { topic: 'items/testItem', payload: 'ON' } },
        });
        const msg = { payload: 'test' };
        expectHandleInputResult(getNodeHandler, msg, node);
    });

    it('should show error message if no controller was specified', async function () {
        const { node } = createGetNodeHandler({ controlResult: null });
        expect(node.status.getCall(0).args[0], 'initializing status called').to.deep.equal({
            fill: 'grey',
            shape: 'ring',
            text: '[12:34:56] initializing...',
        });
        expect(node.status.getCall(1).args[0], 'error status called').to.deep.equal({
            fill: 'red',
            shape: 'ring',
            text: '[12:34:56] no controller',
        });
        expect(node.on.callCount, 'On called twice (for close and input').to.equal(2);
    });

    it('should show error message if both topic and configured identifier are empty', async function () {
        const { node, getNodeHandler } = createGetNodeHandler({ config: {}, controlResult: { ok: true, data: null } });
        const msg = { topic: '', payload: 'test' };
        await getNodeHandler.handleInput(msg);
        expect(node.status.getCall(2).args[0], 'no resource found').to.deep.equal({
            fill: 'red',
            shape: 'ring',
            text: '[12:34:56] no resource found',
        });
        expect(node.error.calledOnce, 'node.error called').to.be.true;
        expect(node.error.firstCall.args[1]).to.equal(msg, 'original msg passed to node.error');
    });
});
