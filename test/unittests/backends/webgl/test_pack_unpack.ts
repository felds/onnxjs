// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.
import {expect} from 'chai';

import {Backend, InferenceHandler, SessionHandler} from '../../../../lib/backend';
import {WebGLInferenceHandler} from '../../../../lib/backends/webgl/inference-handler';
import {WebGLPack} from '../../../../lib/backends/webgl/ops/pack';
import {WebGLReshapePacked} from '../../../../lib/backends/webgl/ops/reshape-packed';
import {WebGLUnpack} from '../../../../lib/backends/webgl/ops/unpack';
import {Profiler} from '../../../../lib/instrument';
import {Tensor} from '../../../../lib/tensor';
import {ShapeUtil} from '../../../../lib/util';

import {createArrayFromTexture, createAscendingArray} from './test_utils';
import {createTextureFromArray, generateExpected, getExpectedElementCount} from './test_utils';

let backend: Backend|undefined;
let sessionhandler: SessionHandler|undefined;
let inferenceHandler: InferenceHandler|undefined;

describe('#UnitTest# - reshape - Tensor pack', () => {
  before('Initialize Context', async () => {
    const profiler = Profiler.create();
    backend = await Backend('webgl');
    sessionhandler = backend.createSessionHandler({profiler});
    inferenceHandler = sessionhandler.createInferenceHandler();
  });

  it(`Test pack kernal`, () => {
    const webglInferenceHandler = inferenceHandler as WebGLInferenceHandler;

    const op = new WebGLReshapePacked();
    const elementCount = 8;
    const inputData = createAscendingArray(elementCount);
    const inputTensorShape = [1, 2, 4];
    const inputTextureShape = [1, 2];
    const inputTensor = new Tensor(inputTensorShape, 'float32', undefined, undefined, inputData);
    const gl = webglInferenceHandler.session.textureManager.glContext.gl;
    webglInferenceHandler.session.textureManager.glContext.checkError();
    const webglTexture = createTextureFromArray(
        webglInferenceHandler.session.textureManager.glContext, inputData, gl.RGBA, inputTextureShape[0],
        inputTextureShape[1]);
    webglInferenceHandler.session.textureManager.glContext.checkError();
    const packedShape = inputTextureShape;
    const textureData = {
      width: inputTextureShape[0],
      height: inputTextureShape[1],
      channels: 4 as const,
      isPacked: true,
      shape: packedShape,
      strides: ShapeUtil.computeStrides(packedShape),
      unpackedShape: inputTensorShape,
      tensor: inputTensor,
      texture: webglTexture!
    };

    webglInferenceHandler.setTextureData(inputTensor.dataId, textureData);

    const outputTextureShape = [2, 1];

    const newShape = new Int32Array([1, 4, 2]);
    const shapeTensor = new Tensor([3], 'int32', undefined, undefined, newShape);

    // compile shader code
    const programInfo = op.createProgramInfo(inferenceHandler! as WebGLInferenceHandler, [inputTensor, shapeTensor]);
    const artifact = webglInferenceHandler.session.programManager.build(programInfo);
    webglInferenceHandler.session.programManager.setArtifact(op, artifact);

    // run kernal and get output
    const runData = op.createRunData(webglInferenceHandler, artifact.programInfo, [inputTensor, shapeTensor]);
    webglInferenceHandler.session.programManager.run(artifact, runData);
    const resultTexture = runData.outputTextureData.texture;
    // const gl = webglInferenceHandler.session.textureManager.glContext.gl;
    const resultDataBuffer = createArrayFromTexture(gl, resultTexture, outputTextureShape[1], outputTextureShape[0]);

    expect(resultDataBuffer).to.not.equal(null);

    console.log(resultDataBuffer);
  });
});

describe('#UnitTest# - pack - Tensor pack', () => {
  before('Initialize Context', async () => {
    const profiler = Profiler.create();
    backend = await Backend('webgl');
    sessionhandler = backend.createSessionHandler({profiler});
    inferenceHandler = sessionhandler.createInferenceHandler();
  });
  const testDataSet = getTestData();

  // iterate through different input texture layout.
  // 'hw-reverted' is the new texture layout all packed kernels use
  // 'hw-unreverted' is the old texture layout existing unpacked kernels use
  // before we unify those two texture layout, pack kernel should be able to handle
  // both texture layout correctly
  const textureLayout = ['hw-reverted', 'hw-unreverted'];

  for (let w = 0; w < textureLayout.length; ++w) {
    for (let k = 0; k < testDataSet.length; ++k) {
      const testData = testDataSet[k];
      describe(`Test pack`, () => {});
      it(`Test pack kernal ${textureLayout[w]} ${JSON.stringify(testData)}`, () => {
        const webglInferenceHandler = inferenceHandler as WebGLInferenceHandler;

        // TODO support WebGl 1.0
        if (webglInferenceHandler.session.textureManager.glContext.version === 1) {
          console.log('Running pack with webgl1 is not supported. Skipping.');
          return;
        }

        const op = new WebGLPack();

        const elementCount = testData.elementCount;
        const inputData = createAscendingArray(elementCount);
        const inputTensorShape = testData.inputShape;
        const outputTextureShape = testData.outputTextureShape;

        const inputTensor = new Tensor(inputTensorShape, 'float32', undefined, undefined, inputData);

        // test old texture layout with width and height not inverted
        if (w === 1) {
          console.log('Testing unreverted HW input texture');

          // use inputTensorShape to create a texture layout that is unpacked(channel === 1)&& hw unreverted.
          const inputUnpackedLayout = webglInferenceHandler.createTextureLayoutFromShape(inputTensorShape);

          // create texture data from the layout. The texture data is cached inside inference handler such that
          // when pack kernel is invoked, it will read this texture data from cache instead of creating it from
          // scratch
          webglInferenceHandler.createTextureDataFromLayoutBindTensor(
              inputUnpackedLayout, inputTensor.type, inputTensor.numberData, inputTensor);
        }

        // compile shader code
        const programInfo = op.createProgramInfo(inferenceHandler! as WebGLInferenceHandler, [inputTensor]);
        const artifact = webglInferenceHandler.session.programManager.build(programInfo);
        webglInferenceHandler.session.programManager.setArtifact(op, artifact);

        // run kernal and get output
        const runData = op.createRunData(webglInferenceHandler, artifact.programInfo, [inputTensor]);
        webglInferenceHandler.session.programManager.run(artifact, runData);
        const resultTexture = runData.outputTextureData.texture;
        const gl = webglInferenceHandler.session.textureManager.glContext.gl;
        const resultDataBuffer =
            createArrayFromTexture(gl, resultTexture, outputTextureShape[1], outputTextureShape[0]);

        expect(resultDataBuffer).to.not.equal(null);

        const outputElementCount = getExpectedElementCount(testData.inputShape);
        expect(resultDataBuffer).to.have.lengthOf(outputElementCount);
        const expectedOutput = generateExpected(inputData, testData.inputShape);
        expect(resultDataBuffer).to.deep.equal(expectedOutput);
      });
    }
  }
});

describe('#UnitTest# - unpack - Tensor unpack', () => {
  before('Initialize Context', async () => {
    const profiler = Profiler.create();
    backend = await Backend('webgl');
    sessionhandler = backend.createSessionHandler({profiler});
    inferenceHandler = sessionhandler.createInferenceHandler();
  });
  const testDataSet = getTestData(false);

  for (let k = 0; k < testDataSet.length; ++k) {
    const testData = testDataSet[k];
    describe(`Test unpack ${JSON.stringify(testData)}`, () => {});
    it(`Test unpack kernal ${testData.inputShape}`, () => {
      const webglInferenceHandler = inferenceHandler as WebGLInferenceHandler;

      // TODO support WebGl 1.0
      if (webglInferenceHandler.session.textureManager.glContext.version === 1) {
        console.log('Running unpack with webgl1 is not supported. Skipping.');
        return;
      }

      const op = new WebGLUnpack();

      const elementCount = testData.elementCount;
      const inputTensorShape = testData.inputShape;
      const inputTextureShape = testData.inputTextureShape;
      const outputTensorShape = testData.outputShape;

      // create input data and tensor. The input data will be used to verify if the output tensor contains the
      // same value but possibly different order depending on our packing algorithm.
      const inputData = createAscendingArray(elementCount);
      const inputTensor = new Tensor(inputTensorShape, 'float32', undefined, undefined, inputData);

      // manually creat packed texture from inputTensor, and insert in cache
      const gl = webglInferenceHandler.session.textureManager.glContext.gl;
      webglInferenceHandler.session.textureManager.glContext.checkError();
      const webglTexture = createTextureFromArray(
          webglInferenceHandler.session.textureManager.glContext, testData.rawData ? testData.rawData : inputData,
          gl.RGBA, inputTextureShape[0], inputTextureShape[1]);
      webglInferenceHandler.session.textureManager.glContext.checkError();
      const packedShape = inputTextureShape;
      const textureData = {
        width: inputTextureShape[0],
        height: inputTextureShape[1],
        channels: 4 as const,
        isPacked: true,
        shape: packedShape,
        strides: ShapeUtil.computeStrides(packedShape),
        unpackedShape: outputTensorShape,
        tensor: inputTensor,
        texture: webglTexture!
      };

      webglInferenceHandler.setTextureData(inputTensor.dataId, textureData);

      // compile shader code
      const programInfo = op.createProgramInfo(inferenceHandler! as WebGLInferenceHandler, [inputTensor]);

      const artifact = webglInferenceHandler.session.programManager.build(programInfo);
      webglInferenceHandler.session.programManager.setArtifact(op, artifact);

      // run kernal and get output
      const runData = op.createRunData(webglInferenceHandler, artifact.programInfo, [inputTensor]);
      webglInferenceHandler.session.programManager.run(artifact, runData);
      const result = runData.outputTextureData.tensor.data;

      const resultDataBuffer = createArrayFromTexture(gl, webglTexture!, inputTextureShape[0], inputTextureShape[1]);

      webglInferenceHandler.session.textureManager.glContext.checkError();
      // verify result.
      const expectedOutput = testData.useGeneratedOutput ? generateExpected(inputData, testData.inputShape) : inputData;
      expect(result).to.not.equal(null);
      expect(result).to.have.lengthOf(elementCount);

      expect(resultDataBuffer).to.deep.equal(testData.rawData ? testData.rawData : inputData);
      const outputElementCount = getExpectedElementCount(testData.inputShape);

      expect(resultDataBuffer).to.have.lengthOf(outputElementCount);
      expect(result).to.deep.equal(expectedOutput);
    });
  }
});
interface TestData {
  elementCount: number;
  inputShape: number[];
  outputShape: number[];
  inputTextureShape: number[];
  outputTextureShape: number[];
  rawData?: Float32Array;
  useGeneratedOutput?: boolean;
}
function getTestData(isPacked = true): TestData[] {
  if (isPacked) {
    return [
      // test scalar
      {elementCount: 1, inputShape: [], outputShape: [], inputTextureShape: [], outputTextureShape: [1, 1]},

      // test 1D tensor
      {elementCount: 1, inputShape: [1], outputShape: [], inputTextureShape: [], outputTextureShape: [1, 1]},
      {elementCount: 16, inputShape: [16], outputShape: [], inputTextureShape: [], outputTextureShape: [1, 8]},
      {elementCount: 9, inputShape: [9], outputShape: [], inputTextureShape: [], outputTextureShape: [1, 5]},

      // test 2D tensor
      {elementCount: 1, inputShape: [1, 1], outputShape: [], inputTextureShape: [], outputTextureShape: [1, 1]},
      {elementCount: 16, inputShape: [4, 4], outputShape: [], inputTextureShape: [], outputTextureShape: [2, 2]},
      {elementCount: 16, inputShape: [2, 8], outputShape: [], inputTextureShape: [], outputTextureShape: [1, 4]},
      {elementCount: 16, inputShape: [8, 2], outputShape: [], inputTextureShape: [], outputTextureShape: [4, 1]},
      {elementCount: 15, inputShape: [3, 5], outputShape: [], inputTextureShape: [], outputTextureShape: [2, 3]},
      {elementCount: 18, inputShape: [3, 6], outputShape: [], inputTextureShape: [], outputTextureShape: [2, 3]},
      {elementCount: 10, inputShape: [2, 5], outputShape: [], inputTextureShape: [], outputTextureShape: [1, 3]},
      {elementCount: 6, inputShape: [1, 6], outputShape: [], inputTextureShape: [], outputTextureShape: [1, 3]},
      {elementCount: 6, inputShape: [6, 1], outputShape: [], inputTextureShape: [], outputTextureShape: [3, 1]},
      {elementCount: 5, inputShape: [5, 1], outputShape: [], inputTextureShape: [], outputTextureShape: [3, 1]},
      {elementCount: 5, inputShape: [1, 5], outputShape: [], inputTextureShape: [], outputTextureShape: [1, 3]},

      // test 3D tensor
      {elementCount: 1, inputShape: [1, 1, 1], outputShape: [], inputTextureShape: [], outputTextureShape: [1, 1]},
      {elementCount: 16, inputShape: [2, 2, 4], outputShape: [], inputTextureShape: [], outputTextureShape: [2, 2]},
      {elementCount: 24, inputShape: [2, 3, 4], outputShape: [], inputTextureShape: [], outputTextureShape: [4, 2]},
      {elementCount: 30, inputShape: [5, 3, 2], outputShape: [], inputTextureShape: [], outputTextureShape: [10, 1]},
      {elementCount: 9, inputShape: [1, 3, 3], outputShape: [], inputTextureShape: [], outputTextureShape: [2, 2]},

      // test 4D tensor
      {elementCount: 1, inputShape: [1, 1, 1, 1], outputShape: [], inputTextureShape: [], outputTextureShape: [1, 1]},
      {elementCount: 15, inputShape: [1, 1, 3, 5], outputShape: [], inputTextureShape: [], outputTextureShape: [2, 3]},
      {elementCount: 16, inputShape: [1, 2, 2, 4], outputShape: [], inputTextureShape: [], outputTextureShape: [2, 2]},
      {elementCount: 32, inputShape: [2, 2, 2, 4], outputShape: [], inputTextureShape: [], outputTextureShape: [4, 2]},
      {elementCount: 36, inputShape: [2, 2, 3, 3], outputShape: [], inputTextureShape: [], outputTextureShape: [8, 2]},
      {elementCount: 80, inputShape: [2, 5, 2, 4], outputShape: [], inputTextureShape: [], outputTextureShape: [10, 2]},
      {elementCount: 12, inputShape: [2, 1, 3, 2], outputShape: [], inputTextureShape: [], outputTextureShape: [4, 1]},
      {
        elementCount: 3840,
        inputShape: [1, 1, 48, 80],
        outputShape: [],
        inputTextureShape: [],
        outputTextureShape: [24, 40]
      },
    ];
  } else {
    return [
      // // test 1D tensor
      {
        elementCount: 8,
        inputShape: [8],
        outputShape: [8],
        inputTextureShape: [4, 1],
        outputTextureShape: [1, 8],
        rawData: new Float32Array([1, 2, 0, 0, 3, 4, 0, 0, 5, 6, 0, 0, 7, 8, 0, 0]),
      },

      // // test 2D tensor
      {
        elementCount: 16,
        inputShape: [4, 4],
        outputShape: [4, 4],
        inputTextureShape: [2, 2],
        outputTextureShape: [4, 4],
        useGeneratedOutput: true,
      },
      {
        elementCount: 8,
        inputShape: [2, 4],
        outputShape: [2, 4],
        inputTextureShape: [2, 1],
        outputTextureShape: [2, 4],
        useGeneratedOutput: true,
      },
      {
        elementCount: 6,
        inputShape: [2, 3],
        outputShape: [2, 3],
        inputTextureShape: [2, 1],
        outputTextureShape: [2, 3],
        rawData: new Float32Array([1, 2, 4, 5, 3, 0, 6, 0]),
      },

      // // test 3d tensor
      {
        elementCount: 16,
        inputShape: [2, 2, 4],
        outputShape: [2, 2, 4],
        inputTextureShape: [2, 2],
        outputTextureShape: [4, 4],
        useGeneratedOutput: true,
      },
      {
        elementCount: 24,
        inputShape: [2, 3, 4],
        outputShape: [2, 3, 4],
        inputTextureShape: [2, 4],
        outputTextureShape: [6, 4],
        rawData: new Float32Array([
          1,  2,  5,  6,  3,  4,  7,  8,  9,  10, 0, 0, 11, 12, 0, 0,
          13, 14, 17, 18, 15, 16, 19, 20, 21, 22, 0, 0, 23, 24, 0, 0
        ])
      },
      // test 4d tensor
      {
        elementCount: 32,
        inputShape: [2, 2, 2, 4],
        outputShape: [2, 2, 2, 4],
        inputTextureShape: [2, 4],
        outputTextureShape: [8, 4],
        useGeneratedOutput: true,
      },
      {
        elementCount: 64,
        inputShape: [2, 2, 4, 4],
        outputShape: [2, 2, 4, 4],
        inputTextureShape: [2, 8],
        outputTextureShape: [16, 4],
        useGeneratedOutput: true,
      },
    ];
  }
}
