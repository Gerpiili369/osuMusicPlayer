const
    RPC = require('discord-rpc'),
    rpc = new RPC.Client({ transport: 'ipc' });
let activity;

rpc.on('ready', () => activity && rpc.setActivity(activity));
rpc.login({ clientId: '530215411560742942' });

module.exports = activityNew => {
    activity = {
        ...activityNew,
        startTimestamp: new Date(),
        largeImageKey: 'osu-icon',
        smallImageKey: 'app-icon',
        instance: false
    }
    rpc.setActivity(activity);
}
