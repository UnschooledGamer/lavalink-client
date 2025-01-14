import { EventEmitter } from "events";
import { DefaultSources, SourceLinksRegexes } from "./LavalinkManagerStatics";
import { NodeManager } from "./NodeManager";
import { DestroyReasons, Player } from "./Player";
import { DefaultQueueStore } from "./Queue";
import { ManagerUtils, MiniMap } from "./Utils";
export class LavalinkManager extends EventEmitter {
    static DefaultSources = DefaultSources;
    static SourceLinksRegexes = SourceLinksRegexes;
    initiated = false;
    players = new MiniMap();
    applyOptions(options) {
        this.options = {
            client: {
                ...(options?.client || {}),
                id: options?.client?.id,
                username: options?.client?.username ?? "lavalink-client"
            },
            sendToShard: options?.sendToShard,
            nodes: options?.nodes,
            playerOptions: {
                applyVolumeAsFilter: options?.playerOptions?.applyVolumeAsFilter ?? false,
                clientBasedPositionUpdateInterval: options?.playerOptions?.clientBasedPositionUpdateInterval ?? 100,
                defaultSearchPlatform: options?.playerOptions?.defaultSearchPlatform ?? "ytsearch",
                onDisconnect: {
                    destroyPlayer: options?.playerOptions?.onDisconnect?.destroyPlayer ?? true,
                    autoReconnect: options?.playerOptions?.onDisconnect?.autoReconnect ?? false
                },
                onEmptyQueue: {
                    autoPlayFunction: options?.playerOptions?.onEmptyQueue?.autoPlayFunction ?? null,
                    destroyAfterMs: options?.playerOptions?.onEmptyQueue?.destroyAfterMs ?? undefined
                },
                volumeDecrementer: options?.playerOptions?.volumeDecrementer ?? 1,
                requesterTransformer: options?.playerOptions?.requesterTransformer ?? null,
                useUnresolvedData: options?.playerOptions?.useUnresolvedData ?? false,
            },
            linksWhitelist: options?.linksWhitelist ?? [],
            linksBlacklist: options?.linksBlacklist ?? [],
            autoSkip: options?.autoSkip ?? true,
            autoSkipOnResolveError: options?.autoSkipOnResolveError ?? true,
            emitNewSongsOnly: options?.emitNewSongsOnly ?? false,
            queueOptions: {
                maxPreviousTracks: options?.queueOptions?.maxPreviousTracks ?? 25,
                queueChangesWatcher: options?.queueOptions?.queueChangesWatcher ?? null,
                queueStore: options?.queueOptions?.queueStore ?? new DefaultQueueStore(),
            },
            advancedOptions: {
                debugOptions: {
                    noAudio: options?.advancedOptions?.debugOptions?.noAudio ?? false,
                    playerDestroy: {
                        dontThrowError: options?.advancedOptions?.debugOptions?.playerDestroy?.dontThrowError ?? false,
                        debugLog: options?.advancedOptions?.debugOptions?.playerDestroy?.debugLog ?? false,
                    }
                }
            }
        };
        return;
    }
    validateOptions(options) {
        if (typeof options?.sendToShard !== "function")
            throw new SyntaxError("ManagerOption.sendToShard was not provided, which is required!");
        // only check in .init()
        // if(typeof options?.client !== "object" || typeof options?.client.id !== "string") throw new SyntaxError("ManagerOption.client = { id: string, username?:string } was not provided, which is required");
        if (options?.autoSkip && typeof options?.autoSkip !== "boolean")
            throw new SyntaxError("ManagerOption.autoSkip must be either false | true aka boolean");
        if (options?.autoSkipOnResolveError && typeof options?.autoSkipOnResolveError !== "boolean")
            throw new SyntaxError("ManagerOption.autoSkipOnResolveError must be either false | true aka boolean");
        if (options?.emitNewSongsOnly && typeof options?.emitNewSongsOnly !== "boolean")
            throw new SyntaxError("ManagerOption.emitNewSongsOnly must be either false | true aka boolean");
        if (!options?.nodes || !Array.isArray(options?.nodes) || !options?.nodes.every(node => this.utils.isNodeOptions(node)))
            throw new SyntaxError("ManagerOption.nodes must be an Array of NodeOptions and is required of at least 1 Node");
        /* QUEUE STORE */
        if (options?.queueOptions?.queueStore) {
            const keys = Object.getOwnPropertyNames(Object.getPrototypeOf(options?.queueOptions?.queueStore));
            const requiredKeys = ["get", "set", "stringify", "parse", "delete"];
            if (!requiredKeys.every(v => keys.includes(v)) || !requiredKeys.every(v => typeof options?.queueOptions?.queueStore[v] === "function"))
                throw new SyntaxError(`The provided ManagerOption.QueueStore, does not have all required functions: ${requiredKeys.join(", ")}`);
        }
        /* QUEUE WATCHER */
        if (options?.queueOptions?.queueChangesWatcher) {
            const keys = Object.getOwnPropertyNames(Object.getPrototypeOf(options?.queueOptions?.queueChangesWatcher));
            const requiredKeys = ["tracksAdd", "tracksRemoved", "shuffled"];
            if (!requiredKeys.every(v => keys.includes(v)) || !requiredKeys.every(v => typeof options?.queueOptions?.queueChangesWatcher[v] === "function"))
                throw new SyntaxError(`The provided ManagerOption.DefaultQueueChangesWatcher, does not have all required functions: ${requiredKeys.join(", ")}`);
        }
        if (typeof options?.queueOptions?.maxPreviousTracks !== "number" || options?.queueOptions?.maxPreviousTracks < 0)
            options.queueOptions.maxPreviousTracks = 25;
    }
    constructor(options) {
        super();
        if (!options)
            throw new SyntaxError("No Manager Options Provided");
        this.utils = new ManagerUtils(this);
        // use the validators
        this.applyOptions(options);
        this.validateOptions(this.options);
        // create classes
        this.nodeManager = new NodeManager(this);
    }
    createPlayer(options) {
        const oldPlayer = this.getPlayer(options?.guildId);
        if (oldPlayer)
            return oldPlayer;
        const newPlayer = new Player(options, this);
        this.players.set(newPlayer.guildId, newPlayer);
        return newPlayer;
    }
    getPlayer(guildId) {
        return this.players.get(guildId);
    }
    destroyPlayer(guildId, destroyReason) {
        const oldPlayer = this.getPlayer(guildId);
        if (!oldPlayer)
            return;
        return oldPlayer.destroy(destroyReason);
    }
    deletePlayer(guildId) {
        const oldPlayer = this.getPlayer(guildId);
        if (!oldPlayer)
            return;
        // oldPlayer.connected is operational. you could also do oldPlayer.voice?.token 
        if (oldPlayer.voiceChannelId === "string" && oldPlayer.connected && !oldPlayer.get("internal_destroywithoutdisconnect")) {
            if (!this.options?.advancedOptions?.debugOptions?.playerDestroy?.dontThrowError)
                throw new Error(`Use Player#destroy() not LavalinkManager#deletePlayer() to stop the Player ${JSON.stringify(oldPlayer.toJSON?.())}`);
            else
                console.error("Use Player#destroy() not LavalinkManager#deletePlayer() to stop the Player", oldPlayer.toJSON?.());
        }
        return this.players.delete(guildId);
    }
    get useable() {
        return this.nodeManager.nodes.filter(v => v.connected).size > 0;
    }
    /**
     * Initiates the Manager.
     * @param clientData
     */
    async init(clientData) {
        if (this.initiated)
            return this;
        clientData = clientData ?? {};
        this.options.client = { ...(this.options?.client || {}), ...clientData };
        if (!this.options?.client.id)
            throw new Error('"client.id" is not set. Pass it in Manager#init() or as a option in the constructor.');
        if (typeof this.options?.client.id !== "string")
            throw new Error('"client.id" set is not type of "string"');
        let success = 0;
        for (const node of [...this.nodeManager.nodes.values()]) {
            try {
                await node.connect();
                success++;
            }
            catch (err) {
                console.error(err);
                this.nodeManager.emit("error", node, err);
            }
        }
        if (success > 0)
            this.initiated = true;
        else
            console.error("Could not connect to at least 1 Node");
        return this;
    }
    /**
     * Sends voice data to the Lavalink server.
     * @param data
     */
    async sendRawData(data) {
        if (!this.initiated) {
            if (this.options?.advancedOptions?.debugOptions?.noAudio === true)
                console.debug("Lavalink-Client-Debug | NO-AUDIO [::] sendRawData function, manager is not initated yet");
            return;
        }
        if (!("t" in data)) {
            if (this.options?.advancedOptions?.debugOptions?.noAudio === true)
                console.debug("Lavalink-Client-Debug | NO-AUDIO [::] sendRawData function, no 't' in payload-data of the raw event:", data);
            return;
        }
        // for channel Delete
        if ("CHANNEL_DELETE" === data.t) {
            const update = "d" in data ? data.d : data;
            if (!update.guild_id)
                return;
            const player = this.getPlayer(update.guild_id);
            if (player && player.voiceChannelId === update.id)
                return void player.destroy(DestroyReasons.ChannelDeleted);
        }
        // for voice updates
        if (["VOICE_STATE_UPDATE", "VOICE_SERVER_UPDATE"].includes(data.t)) {
            const update = ("d" in data ? data.d : data);
            if (!update) {
                if (this.options?.advancedOptions?.debugOptions?.noAudio === true)
                    console.debug("Lavalink-Client-Debug | NO-AUDIO [::] sendRawData function, no update data found in payload:", data);
                return;
            }
            if (!("token" in update) && !("session_id" in update)) {
                if (this.options?.advancedOptions?.debugOptions?.noAudio === true)
                    console.debug("Lavalink-Client-Debug | NO-AUDIO [::] sendRawData function, no 'token' nor 'session_id' found in payload:", data);
                return;
            }
            const player = this.getPlayer(update.guild_id);
            if (!player) {
                if (this.options?.advancedOptions?.debugOptions?.noAudio === true)
                    console.debug("Lavalink-Client-Debug | NO-AUDIO [::] sendRawData function, No Lavalink Player found via key: 'guild_id' of update-data:", update);
                return;
            }
            if (player.get("internal_destroystatus") === true) {
                if (this.options?.advancedOptions?.debugOptions?.noAudio === true)
                    console.debug("Lavalink-Client-Debug | NO-AUDIO [::] sendRawData function, Player is in a destroying state. can't signal the voice states");
                return;
            }
            if ("token" in update) {
                if (!player.node?.sessionId)
                    throw new Error("Lavalink Node is either not ready or not up to date");
                await player.node.updatePlayer({
                    guildId: player.guildId,
                    playerOptions: {
                        voice: {
                            token: update.token,
                            endpoint: update.endpoint,
                            sessionId: player.voice?.sessionId,
                        }
                    }
                });
                if (this.options?.advancedOptions?.debugOptions?.noAudio === true)
                    console.debug("Lavalink-Client-Debug | NO-AUDIO [::] sendRawData function, Sent updatePlayer for voice token session", { voice: { token: update.token, endpoint: update.endpoint, sessionId: player.voice?.sessionId, } });
                return;
            }
            /* voice state update */
            if (update.user_id !== this.options?.client.id) {
                if (this.options?.advancedOptions?.debugOptions?.noAudio === true)
                    console.debug("Lavalink-Client-Debug | NO-AUDIO [::] sendRawData function, voice update user is not equal to provided client id of the manageroptions#client#id", "user:", update.user_id, "manager client id:", this.options?.client.id);
                return;
            }
            if (update.channel_id) {
                if (player.voiceChannelId !== update.channel_id)
                    this.emit("playerMove", player, player.voiceChannelId, update.channel_id);
                player.voice.sessionId = update.session_id;
                player.voiceChannelId = update.channel_id;
            }
            else {
                if (this.options?.playerOptions?.onDisconnect?.destroyPlayer === true) {
                    return void await player.destroy(DestroyReasons.Disconnected);
                }
                this.emit("playerDisconnect", player, player.voiceChannelId);
                if (!player.paused)
                    await player.pause();
                if (this.options?.playerOptions?.onDisconnect?.autoReconnect === true) {
                    try {
                        await player.connect();
                    }
                    catch {
                        return void await player.destroy(DestroyReasons.PlayerReconnectFail);
                    }
                    return void player.paused && await player.resume();
                }
                player.voiceChannelId = null;
                player.voice = Object.assign({});
                return;
            }
            return;
        }
    }
}
