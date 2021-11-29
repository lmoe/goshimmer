import {action, makeObservable, observable, ObservableMap} from 'mobx';
import {connectWebSocket, registerHandler, unregisterHandler, WSMsgType} from 'WS';
import {default as Viva} from 'vivagraphjs';

export class tangleVertex {
    ID:              string;   
	strongParentIDs: Array<string>;
	weakParentIDs:   Array<string>;
    likedParentIDs:  Array<string>;
    branchID:        string;
	isMarker:        boolean;
    isTx:            boolean;
    isConfirmed:     boolean;
    gof:             string;
	confirmedTime:   number;
    futureMarkers:   Array<string>;
}

export class tangleBooked {
    ID:       string;
    isMarker: boolean;
	branchID: string;
}

export class tangleConfirmed {
    ID: string;
    gof: string;
    confirmedTime: number;
}

export class tangleFutureMarkerUpdated {
    ID: string;
    futureMarkerID: string;
}

export enum parentRefType {
    StrongRef,
    WeakRef,
    LikedRef,
}

export type linkData = {
    "type": parentRefType
}

export type vertexStyle = {
    "color"?: string,
    "size"?: number,
}

export type linkStyle = {
    "color"?: string,
    "width"?: number,
    "lineType"?: string,
}

const vertexStyles: { [key: string]: vertexStyle } = {
    "messagePending": {
        "color": "#b9b7bd",
    },
    "messageConfirmed": {
        "color": "#6c71c4",
    },
    "transactionPending": {
        "color": "#393e46",
    },
    "transactionConfirmed": {
        "color": "#fad02c",
    },
    "tip": {
        "color": "#cb4b16"
    },
    "unknown": {
        "color": "#b58900"
    },
    "selected": {
        "color": "#859900",
        "size": 30
    },
    "default": {
        "size": 20
    }
}

const linkStyles: { [key: string]: linkStyle } = {
    "weakLink": {
        "color": "#586e75",
    },
    "strongLink": {
        "color": "#371A51",
    },
    "likedLink": {
        "color": "#3b6f3b",
    },
    "pastConeLink": {
        "color": "#b58900",
    },
    "futureConeLink": {
        "color": "#d33682"
    }
}


export class TangleStore {
    @observable maxTangleVertices: number = 100;
    @observable messages = new ObservableMap<string, tangleVertex>();
    // might still need markerMap for advanced features
    @observable markerMap = new ObservableMap<string, Array<string>>();
    @observable selectedMsg: tangleVertex = null;
    @observable selected_approvers_count = 0;
    @observable selected_approvees_count = 0;
    @observable paused: boolean = false;
    @observable search: string = "";
    @observable explorerAddress = "localhost:8081";
    msgOrder: Array<any> = [];
    selected_via_click: boolean = false;
    selected_origin_color: number = 0;
    draw: boolean = true;
    vertexChanges = 0;
    graph;
    graphics;
    renderer;

    constructor() {        
        makeObservable(this);
        
        registerHandler(WSMsgType.Message, this.addMessage);
        registerHandler(WSMsgType.MessageBooked, this.setMessageBranch);
        registerHandler(WSMsgType.MessageConfirmed, this.setMessageConfirmedTime);
        registerHandler(WSMsgType.FutureMarkerUpdated, this.updateFutureMarker);
    }

    unregisterHandlers() {
        unregisterHandler(WSMsgType.Message);
        unregisterHandler(WSMsgType.MessageBooked);
        unregisterHandler(WSMsgType.MessageConfirmed);
        unregisterHandler(WSMsgType.FutureMarkerUpdated);
    }

    connect() {
        connectWebSocket("/ws",
        () => {console.log("connection opened")},
        this.reconnect,
        () => {console.log("connection error")});
    }

    reconnect() {
        setTimeout(() => {
            this.connect();
        }, 1000);
    }

    @action
    addMessage = (msg: tangleVertex) => {
        if (this.msgOrder.length >= this.maxTangleVertices) {
            let removed = this.msgOrder.shift();
            this.removeMessage(removed);
        }

        this.msgOrder.push(msg.ID);
        msg.futureMarkers = [];
        this.messages.set(msg.ID, msg);

        if (this.draw) {
            this.drawVertex(msg);
        }
    }

    @action
    removeMessage = (msgID: string) => {
        let msg = this.messages.get(msgID);
        if (msg) {
            if (msg.isMarker) {
                this.markerMap.delete(msgID);
            }
            this.removeVertex(msgID);
            this.messages.delete(msgID);            
        }
    }

    @action
    setMessageBranch = (branch: tangleBooked) => {
        let msg = this.messages.get(branch.ID);
        if (!msg) {
            return;
        }
        
        msg.branchID = branch.branchID;
        msg.isMarker = branch.isMarker;

        this.messages.set(msg.ID, msg);
        // TODO: improve the updated information
        if (this.draw) {
            this.graph.addNode(msg.ID, msg);
        }        
    }

    @action
    setMessageConfirmedTime = (info: tangleConfirmed) => {
        let msg = this.messages.get(info.ID);
        if (!msg) {
            return;
        }

        msg.gof = info.gof;
        msg.isConfirmed = true;
        msg.confirmedTime = info.confirmedTime;
        this.messages.set(msg.ID, msg);
        if (this.draw) {
            this.graph.addNode(info.ID, msg);
            this.updateNodeColor(msg);
        }
    }

    @action
    updateFutureMarker = (fm: tangleFutureMarkerUpdated) => {
        let msg = this.messages.get(fm.ID);
        if (msg) {
            msg.futureMarkers.push(fm.futureMarkerID);
            this.messages.set(fm.ID, msg);
        }

        // update marker map
        let pastconeList = this.markerMap.get(fm.futureMarkerID);
        if (!pastconeList) {
            this.markerMap.set(fm.futureMarkerID, [fm.ID]);
        } else {
            pastconeList.push(fm.ID);
            this.markerMap.set(fm.futureMarkerID, pastconeList);
        }
    }

    @action
    deleteApproveeLink = (approveeId: string) => {
        if (!approveeId) {
            return;
        }
        let approvee = this.messages.get(approveeId);
        if (approvee) {
            if (this.selectedMsg && approveeId === this.selectedMsg.ID) {
                this.clearSelected();
            }
            this.messages.delete(approveeId);
            if (approvee.isMarker) {
                this.markerMap.delete(approveeId);
            }
        }
        this.graph.removeNode(approveeId);
    }

    @action
    pauseResume = () => {
        if (this.paused) {
            this.renderer.resume();
            this.paused = false;
            return;
        }
        this.renderer.pause();
        this.paused = true;
    }

    @action
    updateVerticesLimit = (num: number) => {
        this.maxTangleVertices = num;
    }

    @action
    updateSearch = (search: string) => {
        this.search = search.trim();
    }

    @action
    searchAndHighlight = () => {
        this.clearSelected(true);
        if (!this.search) return;
        
        let msgNode = this.graph.getNode(this.search);
        if (!msgNode) return;
        
        this.updateSelected(msgNode.data, false);
    }
    
    updateExplorerAddress = (addr: string) => {
        this.explorerAddress = addr;
    }

    drawExistedMsgs = () => {
        this.messages.forEach((msg) => {
            this.drawVertex(msg);
        })
    }

    updateDrawStatus = (draw: boolean) => {
        this.draw = draw;
    }

    clearGraph = () => {
        this.graph.clear();
    }

    centerEntireGraph = () => {
        let graph = document.getElementById('tangleVisualizer');
        let centerY = graph.offsetHeight / 2;
        let centerX = graph.offsetWidth / 2;

        this.renderer.moveTo(centerX, centerY);
      }

    drawVertex = (msg: tangleVertex) => {
        let node;
        let existing = this.graph.getNode(msg.ID);
        if (existing) {
            node = existing
        } else {
            node = this.graph.addNode(msg.ID, msg);
            this.updateNodeColor(msg);
        }

        let drawVertexParentReference = (parentType: parentRefType, parentIDs: Array<string>) => {
            if (parentIDs) {
                parentIDs.forEach((value) => {
                    // if value is valid AND (links is empty OR there is no between parent and children)
                    if (value && ((!node.links || !node.links.some(link => link.fromId === value)))) {
                        // draw the link only when the parent exists
                        let existing = this.graph.getNode(value);
                        if (existing) {
                            let data: linkData = {"type": parentType}
                            let link = this.graph.addLink(value, msg.ID, data);
                            this.updateLinkColor(link)
                        }
                    }
                })
            }

        }
        drawVertexParentReference(parentRefType.StrongRef, msg.strongParentIDs)
        drawVertexParentReference(parentRefType.WeakRef, msg.weakParentIDs)
        drawVertexParentReference(parentRefType.LikedRef, msg.likedParentIDs)
    }

    // TODO: take tangleVertex instead
    // only update color when finalized
    updateNodeColor = (msg: tangleVertex) => {
        let nodeUI = this.graphics.getNodeUI(msg.ID);
        let color = "";
        if (!nodeUI || !msg || msg.gof === "GoF(None)") {
            color = vertexStyles["unknown"].color;
        }
        if (msg.isTx) {
            color = vertexStyles["transactionPending"].color;
        }
        color = vertexStyles["messagePending"].color;

        nodeUI.color = parseColor(color);
    }

    updateLinkColor = (link: any) => {
        // update link line type and color based on reference type
        const linkUI = this.graphics.getLinkUI(link.id);
        const parentType = link.data.type
        if (linkUI) {
            switch (parentType) {
                case parentRefType.StrongRef: {
                    linkUI.color = parseColor(linkStyles["strongLink"].color)
                    break;
                }
                case parentRefType.WeakRef: {
                    linkUI.color = parseColor(linkStyles["weakLink"].color)
                    break;
                }
                case parentRefType.LikedRef: {
                    linkUI.color = parseColor(linkStyles["likedLink"].color)
                    break;
                }
            }
        }
    }

    removeVertex = (msgID: string) => {
        let vert = this.messages.get(msgID);
        if (vert) {
            this.messages.delete(msgID);
            this.graph.removeNode(msgID);

            vert.strongParentIDs.forEach((value) => {
                this.deleteApproveeLink(value)
            })
            vert.weakParentIDs.forEach((value) => {
                this.deleteApproveeLink(value)
            })
        }
    }

    @action
    updateSelected = (vert: tangleVertex, viaClick?: boolean) => {
        if (!vert) return;

        this.selectedMsg = vert;
        this.selected_via_click = !!viaClick;

        // mutate links
        let node = this.graph.getNode(vert.ID);
        let nodeUI = this.graphics.getNodeUI(vert.ID);
        this.selected_origin_color = nodeUI.color
        nodeUI.color = parseColor(vertexStyles["selected"].color);
        nodeUI.size = vertexStyles["selected"].size;

        const seenForward = [];
        const seenBackwards = [];
        dfsIterator(this.graph,
            node,
            node => {
                this.selected_approvers_count++;
            },
            true,
            link => {
                const linkUI = this.graphics.getLinkUI(link.id);
                linkUI.color = parseColor(linkStyles["futureConeLink"].color);
            },
            seenForward
        );
        dfsIterator(this.graph, node, node => {
                this.selected_approvees_count++;
            }, false, link => {
                const linkUI = this.graphics.getLinkUI(link.id);
                linkUI.color = parseColor(linkStyles["pastConeLink"].color);
            },
            seenBackwards
        );
    }

    resetLinks = () => {
        this.graph.forEachLink((link) => {
            this.updateLinkColor(link)
        });
    }

    @action
    clearSelected = (force_clear?: boolean) => {
        if (!this.selectedMsg || (this.selected_via_click && !force_clear)) {
            return;
        }

        this.selected_approvers_count = 0;
        this.selected_approvees_count = 0;

        // clear link highlight
        let node = this.graph.getNode(this.selectedMsg.ID);
        if (!node) {
            // clear links
            this.resetLinks();
            return;
        }

        let nodeUI = this.graphics.getNodeUI(this.selectedMsg.ID);
        nodeUI.color = this.selected_origin_color;
        nodeUI.size = vertexStyles["default"].size;

        const seenForward = [];
        const seenBackwards = [];
        dfsIterator(this.graph, node, node => {
            }, true,
            link => {
                const linkUI = this.graphics.getLinkUI(link.id);
                linkUI.color = parseColor(linkStyles["pastCone"]);
            },
            seenBackwards
        );
        dfsIterator(this.graph, node, node => {
            }, false,
            link => {
                const linkUI = this.graphics.getLinkUI(link.id);
                linkUI.color = parseColor(linkStyles["futureCone"]);
            },
            seenForward
        );

        this.selectedMsg = null;
        this.selected_via_click = false;
    }

    start = () => {
        this.graph = Viva.Graph.graph();

        let graphics: any = Viva.Graph.View.webglGraphics();

        const layout = Viva.Graph.Layout.forceDirected(this.graph, {
            springLength: 10,
            springCoeff: 0.0001,
            stableThreshold: 0.15,
            gravity: -2,
            dragCoeff: 0.02,
            timeStep: 20,
            theta: 0.8,
        });

        graphics.node((node) => {
            return Viva.Graph.View.webglSquare(vertexStyles["default"].size, vertexStyles["messagePending"].color);
        })
        graphics.link(() => Viva.Graph.View.webglLine(parseColor(linkStyles["strongLink"])));
        let ele = document.getElementById('tangleVisualizer');
        this.renderer = Viva.Graph.View.renderer(this.graph, {
            container: ele, graphics, layout,
        });

        let events = Viva.Graph.webglInputEvents(graphics, this.graph);

        events.click((node) => {
            this.clearSelected(true);
            this.updateSelected(node.data, true);
        });

        this.graphics = graphics;
        this.renderer.run();
    }

    stop = () => {
        this.unregisterHandlers();
        this.renderer.dispose();
        this.graph = null;
        this.selectedMsg = null;
    }
}

export default TangleStore;

// copied over and refactored from https://github.com/glumb/IOTAtangle
function dfsIterator(graph, node, cb, up, cbLinks: any = false, seenNodes = []) {
    seenNodes.push(node);
    let pointer = 0;

    while (seenNodes.length > pointer) {
        const node = seenNodes[pointer++];

        if (cb(node)) return true;

        for (const link of node.links) {
            if (cbLinks) cbLinks(link);

            if (!up && link.toId === node.id && !seenNodes.includes(graph.getNode(link.fromId))) {
                seenNodes.push(graph.getNode(link.fromId));
                continue;
            }

            if (up && link.fromId === node.id && !seenNodes.includes(graph.getNode(link.toId))) {
                seenNodes.push(graph.getNode(link.toId));
            }
        }
    }
}

function parseColor(color): any {
    let parsedColor = 0x009ee8ff;

    if (typeof color === 'number') {
        return color;
    }

    if (typeof color === 'string' && color) {
        if (color.length === 4) {
            // #rgb, duplicate each letter except first #.
            color = color.replace(/([^#])/g, '$1$1');
        }
        if (color.length === 9) {
            // #rrggbbaa
            parsedColor = parseInt(color.substr(1), 16);
        } else if (color.length === 7) {
            // or #rrggbb.
            parsedColor = (parseInt(color.substr(1), 16) << 8) | 0xff;
        } else {
            throw 'Color expected in hex format with preceding "#". E.g. #00ff00. Got value: ' + color;
        }
    }

    return parsedColor;
}