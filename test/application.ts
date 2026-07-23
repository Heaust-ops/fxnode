/** Test-only headless authority assembled from the example's public node definitions. */
import { compileFxNodeComposition, composeNode, composeSocket, setTheme } from "@lib/composition/index.js";
import type { FxNodeCompositionData } from "@lib/composition/index.js";
import { bindFxNodeHeadless } from "@lib/headless-runtime.js";
import {
  APPLICATION_HEADER_STYLES,
  APPLICATION_ID,
  APPLICATION_RESOURCES,
  APPLICATION_VERSION,
  applicationCompatibility,
} from "../example/nodes/application.js";
import { applicationTheme } from "../example/nodes/theme.js";
import {
  anySocket,
  floatSocket,
  vectorSocket,
  colorSocket,
  shaderSocket,
  geometrySocket,
} from "../example/nodes/socket-types.js";
import { frameNode } from "../example/nodes/common/frame.js";
import { rerouteNode } from "../example/nodes/common/reroute.js";
import { groupInputNode } from "../example/nodes/common/group-input.js";
import { groupOutputNode } from "../example/nodes/common/group-output.js";
import { valueNode } from "../example/nodes/shader/value.js";
import { colorNode } from "../example/nodes/shader/color.js";
import { mathNode } from "../example/nodes/shader/math.js";
import { vectorMathNode } from "../example/nodes/shader/vector-math.js";
import { mixNode } from "../example/nodes/shader/mix.js";
import { colorRampNode } from "../example/nodes/shader/color-ramp.js";
import { textureCoordinateNode } from "../example/nodes/shader/texture-coordinate.js";
import { noiseTextureNode } from "../example/nodes/shader/noise-texture.js";
import { imageTextureNode } from "../example/nodes/shader/image-texture.js";
import { principledBsdfNode } from "../example/nodes/shader/principled-bsdf.js";
import { materialOutputNode } from "../example/nodes/shader/material-output.js";
import { positionNode } from "../example/nodes/geometry/position.js";
import { meshCubeNode } from "../example/nodes/geometry/mesh-cube.js";
import { setPositionNode } from "../example/nodes/geometry/set-position.js";
import { transformGeometryNode } from "../example/nodes/geometry/transform-geometry.js";
import { joinGeometryNode } from "../example/nodes/geometry/join-geometry.js";
import { imageNode } from "../example/nodes/compositor/image.js";
import { colorBalanceNode } from "../example/nodes/compositor/color-balance.js";

const seed = {
  schemaVersion: 2,
  id: APPLICATION_ID,
  version: APPLICATION_VERSION,
  nodeStyles: APPLICATION_HEADER_STYLES,
  resources: APPLICATION_RESOURCES,
  compatibility: applicationCompatibility,
  socketTypes: {},
  nodes: {},
} as const;
const themed = setTheme(seed, applicationTheme);
const socket1 = composeSocket(themed, ...anySocket);
const socket2 = composeSocket(socket1, ...floatSocket);
const socket3 = composeSocket(socket2, ...vectorSocket);
const socket4 = composeSocket(socket3, ...colorSocket);
const socket5 = composeSocket(socket4, ...shaderSocket);
const socket6 = composeSocket(socket5, ...geometrySocket);
const node1 = composeNode(socket6, ...frameNode);
const node2 = composeNode(node1, ...rerouteNode);
const node3 = composeNode(node2, ...groupInputNode);
const node4 = composeNode(node3, ...groupOutputNode);
const node5 = composeNode(node4, ...valueNode);
const node6 = composeNode(node5, ...colorNode);
const node7 = composeNode(node6, ...mathNode);
const node8 = composeNode(node7, ...vectorMathNode);
const node9 = composeNode(node8, ...mixNode);
const firstBranch = composeNode(node9, ...colorRampNode);
const node11 = composeNode(socket6, ...textureCoordinateNode);
const node12 = composeNode(node11, ...noiseTextureNode);
const node13 = composeNode(node12, ...imageTextureNode);
const node14 = composeNode(node13, ...principledBsdfNode);
const node15 = composeNode(node14, ...materialOutputNode);
const secondBranch = composeNode(node15, ...positionNode);
const node17 = composeNode(socket6, ...meshCubeNode);
const node18 = composeNode(node17, ...setPositionNode);
const node19 = composeNode(node18, ...transformGeometryNode);
const node20 = composeNode(node19, ...joinGeometryNode);
const node21 = composeNode(node20, ...imageNode);
const thirdBranch = composeNode(node21, ...colorBalanceNode);
const source: FxNodeCompositionData = {
  ...firstBranch,
  nodes: { ...firstBranch.nodes, ...secondBranch.nodes, ...thirdBranch.nodes },
};
export const APPLICATION_COMPILED = compileFxNodeComposition(source);
export const APPLICATION_HEADLESS = bindFxNodeHeadless(APPLICATION_COMPILED);
