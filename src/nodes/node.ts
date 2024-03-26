import express from "express";
import {BASE_NODE_PORT} from "../config";
import {NodeState, Value} from "../types";
import {delay} from "../utils";

export async function node(
  nodeId: number, // the ID of the node
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValue: Value, // initial value of the node
  isFaulty: boolean, // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
  setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const server = express();
  server.use(express.json());

  let nodeStatus: NodeState = {
    killed: false,
    x: isNodeFaulty ? null : startingValue,
    decided: isNodeFaulty ? null : false,
    k: isNodeFaulty ? null : 0,
  };

  let proposalRecords: Map<number, Value[]> = new Map();
  let voteRecords: Map<number, Value[]> = new Map();

  server.get("/status", (req, res) => {
    const nodeCondition = isNodeFaulty ? "faulty" : "active";
    const httpStatus = isNodeFaulty ? 500 : 200;
    res.status(httpStatus).send(nodeCondition);
  });

  server.post("/message", async (req, res) => {
    const {k, x, type} = req.body;

    if (!isNodeFaulty && !nodeStatus.killed) {
      if (type === "proposal") {
        proposalRecords.has(k) || proposalRecords.set(k, []);
        proposalRecords.get(k)?.push(x);

        if (proposalRecords.get(k)?.length >= totalNodes - faultThreshold) {
          const preferredValue = decideValueBasedOnMajority(proposalRecords.get(k)!);
          const finalDecision = preferredValue === null ? Math.round(Math.random()) : preferredValue;

          Array.from({length: totalNodes}, (_, i) => i).forEach(index => {
            sendNodeMessage(index, {k, x: finalDecision, type: "vote"});
          });
        }
      } else if (type === "vote") {
        voteRecords.has(k) || voteRecords.set(k, []);
        voteRecords.get(k)?.push(x);

        if (voteRecords.get(k)?.length >= totalNodes - faultThreshold) {
          const voteSummary = calculateVotes(voteRecords.get(k)!);

          if (voteSummary[0] >= faultThreshold + 1 || voteSummary[1] >= faultThreshold + 1) {
            nodeStatus.x = voteSummary[0] >= faultThreshold + 1 ? 0 : 1;
            nodeStatus.decided = true;
          } else {
            nodeStatus.x = decideValueBasedOnMajority(voteRecords.get(k)!) ?? Math.round(Math.random());
            nodeStatus.k = (nodeStatus.k ?? 0) + 1;
            Array.from({length: totalNodes}, (_, i) => i).forEach(index => {
              sendNodeMessage(index, {k: nodeStatus.k, x: nodeStatus.x, type: "proposal"});
            });
          }
        }
      }
    }

    res.status(200).send("Processed.");
  });

  server.get("/start", async (req, res) => {
    while (!areNodesReady()) {
      await delay(5);
    }

    if (!isNodeFaulty) {
      nodeStatus = {...nodeStatus, k: 1, x: startingValue, decided: false};
      Array.from({length: totalNodes}, (_, i) => i).forEach(index => {
        sendNodeMessage(index, {k: nodeStatus.k, x: nodeStatus.x, type: "proposal"});
      });
    }

    res.status(200).send("Algorithm initiated.");
  });

  server.get("/stop", async (req, res) => {
    nodeStatus.killed = true;
    res.status(200).send("Terminated");
  });

  server.get("/getState", (req, res) => {
    res.status(200).send(nodeStatus);
  });

  return server.listen(BASE_NODE_PORT + uniqueId, () => {
    console.log(`Node ${uniqueId} is up at port ${BASE_NODE_PORT + uniqueId}`);
    markNodeAsReady(uniqueId);
  });
}

function sendNodeMessage(nodeIndex: number, message: { k: number; x: Value; type: string }) {
  fetch(`http://localhost:${BASE_NODE_PORT + nodeIndex}/message`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(message),
  });
}

function decideValueBasedOnMajority(values: Value[]): Value | null {
  const countMap = values.reduce((acc, value) => {
  if(value !== '?') {
    acc[value] = (acc[value] || 0) + 1;
    }
    return acc;
    }, {0: 0, 1: 0});

  if (countMap[0] > countMap[1]) {
    return 0;
  } else if (countMap[1] > countMap[0]) {
    return 1;
  } else {
    return null;
  }
}

function calculateVotes(votes: Value[]): [number, number] {
  const voteTally = votes.reduce((acc, vote) => {
  if(vote !== '?') {
    acc[vote]++;
    }
    return acc;
    }, [0, 0]);

  return [voteTally[0], voteTally[1]];
}
