const
    Emitter = require('events'),
    remote = require('electron').remote,
    { app, BrowserWindow, dialog, globalShortcut } = remote,
    win = remote.getCurrentWindow(),
    setActivity = require('./rpc.js'),
    path = require('path'),
    fs = require('fs');

// Window control.
document.onreadystatechange = () => {
    if (document.readyState === 'complete') {
        document.getElementById('minimize').onclick = () => BrowserWindow.getFocusedWindow().minimize();
        document.getElementById('maximize').onclick = () => {
            const window = BrowserWindow.getFocusedWindow();
            if (window.isMaximized()) window.unmaximize();
            else window.maximize();
        };
        document.getElementById('close').onclick = () => BrowserWindow.getFocusedWindow().close();
    }
}

class Song {
    constructor(src, osu) {
        const type = (osu ? 'osu!' : '') + typeof src;
        switch (type) {
            case 'object':
                this.url = src.url;
                this.id = null;
                this.artist = src.artist || '';
                this.song =  src.title || '';
                this.file = src.url.join('').split('\\').help.pop();
                break;
            case 'string':
                this.url = src;
                this.id = null;
                this.artist =
                this.song = '';
                this.file = src.join('').split('\\').help.pop();
                break;
            case 'osu!object':
                if (src.dir) {
                    this.url = path.join(src.dir, src.subdir, src.item);
                    this.file = src.item;
                    this.id = '';

                    let help = src.subdir;
                    // Get numbers for ID from the string.
                    for (const num of help) {
                        if ('0123456789'.indexOf(num) < 0) break;
                        this.id += num;
                    }
                    // Remove collected ID from the string.
                    help = help.substring(this.id.length);
                    // Remove empty space from the beginning.
                    if (help[0] == ' ') help = help.replace(' ', '')
                    if (help[0] == '_') help = help.replace('_', '');
                    // Extract artist and song name from the rest of the string.
                    // They should be separated by " - ".
                    help = help.split(' - ');
                    this.artist = help.shift();
                    this.song = help.join(' - ');
                    // Underscore double check.
                    if (!this.song) {
                        help = this.artist.split('_-_');
                        this.artist = help.shift();
                        this.song = help.join('_-_');
                    }

                } else {
                    this.url = 'https:' + src.preview_url;
                    this.id = src.id;
                    this.artist = src.artist;
                    this.song =  src.title;
                    this.file = `https://osu.ppy.sh/beatmapsets/${ this.id }/download`;
                    this.isPreview = true;
                }
                this.isOsu = true;
                break;
            default:
                throw new Error('Song creation failed.');
        }
    }
}

class Player extends Emitter {
    constructor(element) {
        super();
        this.audioInit(element);
        this.songRoot = path.join(app.getPath('home'), 'AppData', 'Local', 'osu!', 'Songs');
    }

    audioInit(element) {
        this.audio = element;
        this.audio.autoplay = true;
        this.audio.onplay = () => this.emit('title', true);
        this.audio.onpause = () => this.emit('title', false);
        this.audio.onended = () => this.next();
        this.audio.ontimeupdate = () => {
            this.prog = (this.audio.currentTime / this.audio.duration) || 0;
            this.emit('timeUpdate', this.audio.currentTime);
        }
    }

    load() {
        const tasks = [];
        this.list = [];
        this.maps = [];
        tasks.push(this.readDir(this.songRoot));
        Promise.all(tasks).then(() => this.emit('songListUpdate')).catch(err => this.emit('error', err));
    }

    readDir(dir, subdir) {
        const
            player = this,
            isOsu = dir.indexOf(path.join('osu!', 'Songs')) > -1,
            folder = subdir ? path.join(dir, subdir) : dir;
            
        return new Promise((resolve, reject) => fs.readdir(folder, (err, res) => {
            const subPromList = [];
            if (err) reject(err);
            else for (const item of res) switch (item.substring(item.length - item.split('').reverse().join('').indexOf('.') - 1).toLowerCase()) {
                case '':
                    if (!isOsu || !subdir) subPromList.push(player.readDir(folder, item));
                    break;
                case '.mp3':
                    const song = new Song({ dir, subdir, item }, isOsu);
                    player.list.push(song);
                    if (song.isOsu && song.id) player.maps.push(song.id);
                    break;
            }
            Promise.all(subPromList).then(list => {
                player.emit('songListUpdate');
                resolve(list);
            });
        }));
    }

    more() {
        const player = this;
        let url = 'https://osu.ppy.sh/beatmapsets/search';
        if (player.cursor) url += `?cursor%5Bapproved_date%5D=${ player.cursor.date }&cursor%5B_id%5D=${ player.cursor.id }`;
        return new Promise((resolve, reject) => fetch(url).then(res => res.json()).then(data => {
            if (data.error) reject(error);
            else {
                for (const item of data.beatmapsets) if (player.maps.indexOf(item.id) < 0) player.list.push(new Song(item, true));
                player.cursor = {
                    date: data.cursor.approved_date,
                    id: data.cursor._id,
                }
                player.emit('songListUpdate');
                resolve();
            }
        }).catch(reject));
    }

    shuffle() {
        for (let i = 0; i < this.list.length * 10; i++) {
            const
                song1 = Math.floor(Math.random() * this.list.length),
                song2 = Math.floor(Math.random() * this.list.length),
                mem = this.list[song1];

            this.list[song1] = this.list[song2];
            this.list[song2] = mem;
        }
        this.emit('songListUpdate');
        return this;
    }

    prev() {
        if (this.audio.currentTime > 3) this.audio.currentTime = 0;
        else this.playByIndex(this.list.indexOf(this.current) - 1);
    }

    next() {
        this.playByIndex(this.list.indexOf(this.current) + 1);
    }

    stop() {
        const old = this.current;
        // Change current.
        this.current = null;
        // load song.
        this.audio.src = '';
        // this.audio.load();
        this.emit('songChange', old, this.current);
        app.emit('audio');
    }

    playByIndex(i) {
        this.old = this.current;
        // Make sure index is a number.
        i = Number(i);
        if (isNaN(i)) return this.emit('error', `Invalid index: ${ i }`);
        // Make sure index is within the list.
        if (i > this.list.length - 1) i = 0;
        if (i < 0) i = this.list.length - 1;
        // Change current.
        this.current = this.list[i];
        // load song.
        this.audio.src = this.current.url;
        this.audio.load();
        this.emit('songChange', this.old, this.current);
        app.emit('audio', this.audio.src);
    }

    toggle() {
        if (this.current) {
            if (this.audio.paused) this.audio.play();
            else this.audio.pause();
        } else this.playByIndex(0);
    }
}

addEventListener('DOMContentLoaded', () => {
    const
        icon = document.getElementById('icon'),
        title = document.getElementById('title'),
        table = document.getElementById('table'),
        thead = document.getElementsByTagName('thead')[0],
        osuOnly = document.getElementsByClassName('osuOnly'),
        nextButt = document.getElementById('next'),
        prevButt = document.getElementById('prev'),
        currButt = document.getElementById('curr'),
        moreButt = document.getElementById('more'),
        player = new Player(document.getElementById('audio'));

    player.on('songListUpdate', updateTable);
    player.on('timeUpdate', () => win.setProgressBar(player.prog, {
        mode: player.audio.paused ? 'paused' : 'normal'
    }));
    player.on('title', isSong => {
        if (isSong && player.current) {
            if (player.current.isOsu) {
                title.innerHTML = player.current.song;
                setActivity({
                    details: player.current.artist,
                    state: player.current.song,
                    largeImageText: 'Mapset ID: ' + player.current.id,
                    smallImageText: player.current.file,
                    partySize:  player.list.indexOf(player.current) + 1 ,
                    partyMax: player.list.length,
                });
            } else {
                title.innerHTML = player.current.file;
                setActivity({ details: player.current.file });
            }
        } else {
            title.innerHTML = 'osu! music player';
            setActivity({
                details: 'Currently not playing music.',
                state: 'Idle',
            });
            if (player.prog) win.setProgressBar(player.prog, { mode: 'paused' })
        }
    });
    player.on('error', err => {
        // Prompt to select a new song folder if current doesn't exist.
        if (
            err.message.indexOf('ENOENT') > -1 &&
            err.message.indexOf(player.songRoot) > -1
        ) dialog.showMessageBox({
            title: 'Invalid song folder.',
            type: 'warning',
            buttons: ['OK', 'Select new'],
            message: `Folder "${ player.songRoot } doesn't exist!"`,
        }, res => {
            if (res == 1) openSongFolder();
        });
        else console.error(err);
    });

    player.load();

    // Playback & controls.
    nextButt.onclick = () => player.next();
    prevButt.onclick = () => player.prev();
    currButt.onclick = scrollToCurrent;
    moreButt.onclick = () => player.more();

    // Menu
    icon.onclick = () => dialog.showMessageBox({
        title: 'Options.',
        buttons: [
            'Cancel',
            'Shuffle songs.',
            'Reload all songs.',
            'Change song folder.',
            'Change audio device.',
        ],
    }, res => {
        switch (res) {
            case 1: player.shuffle();
                break;
            case 2: player.load();
                break;
            case 3: openSongFolder();
                break;
            case 4: changeAudioDevice();
                break;
        }
    });

    player.on('songChange', (old, current) => {
        if (old) {
            old.row.style.cssText = '';
            old.row.classList.remove('current');
            old.row.classList.remove('expand');
        }
        if (current) {
            current.row.classList.add('current');
            currButt.innerHTML =
                `Track ${ player.list.indexOf(current) + 1 } / ${ player.list.length }`;
            // Change track number & bg image.
            if (player.current.isOsu) {
                const imgUrl = `https://assets.ppy.sh/beatmaps/${
                    current.row.childNodes[0].innerText
                }/covers/cover.jpg`;

                fetch(imgUrl).then(res => {
                    if (res.status == 200) {
                        current.row.classList.add('expand');
                        current.row.style.cssText =
                            `background-image: url(${ imgUrl });`;
                        scrollToCurrent();
                    }
                }).catch(console.error);
            }

            player.emit('title', true);
            scrollToCurrent();
        } else {
            currButt.innerHTML = 'Track N/A';
            player.emit('title', false);
            thead.scrollIntoView({
                behavior: 'smooth', block: 'center'
            });
        }
    });

    // Keyboard media controls.
    globalShortcut.register('MediaPlayPause', () => player.toggle());
    globalShortcut.register('MediaStop', () => player.stop());
    globalShortcut.register('MediaPreviousTrack', () => player.prev());
    globalShortcut.register('MediaNextTrack', () => player.next());

    win.setThumbarButtons([
        // {
        //     tooltip: 'Stop',
        //     icon: 'osuPlayer.png',
        //     click () { player.stop() },
        // },
        {
            tooltip: 'Previous',
            icon: 'osuPlayer.png',
            click () { player.prev() },
        },
        {
            tooltip: 'PlayPause',
            icon: 'osuPlayer.png',
            click () { player.toggle() },
        },
        {
            tooltip: 'Next',
            icon: 'osuPlayer.png',
            click () { player.next() },
        },
    ])

    function openSongFolder() {
        // Choose new song folder.
        dialog.showOpenDialog({
            title: 'Open song folder.',
            properties: ['openDirectory']
        }, filePaths => {
            if (filePaths) {
                player.songRoot = filePaths[0];
                player.load();
            }
        });
    }

    function changeAudioDevice() {
        // Get ALL available devices.
        navigator.mediaDevices.enumerateDevices().then(devices => {
            const deviceNames = [], deviceIds = [];
            // Select only audio output devices.
            for (const device of devices) if (device.kind === 'audiooutput') {
                deviceNames.push(device.label);
                deviceIds.push(device.deviceId);
            }

            // Choose new playback device.
            dialog.showMessageBox({
                title: 'Playback devices',
                buttons: ['Cancel', ...deviceNames],
            }, res => {
                res--;
                if (res >= 0) player.audio.setSinkId(deviceIds[res])
                    .then(() => alert('Audio device succesfully changed!'))
                    .catch(console.error);
            });
        });
    }

    function updateTable() {
        const newBody = document.createElement('tbody');
        // Add songs to the table.
        for (const song of player.list) {
            // Create the td elements.
            const row = {
                id: document.createElement('td'),
                artist: document.createElement('td'),
                song: document.createElement('td'),
                file: document.createElement('td'),
            };

            for (var prop in row) row[prop].innerHTML = song[prop];

            // Create a table row for the song.
            song.row = document.createElement('tr');

            // Add classes.
            row.id.classList.add('numbers');
            row.file.classList.add('filename');

            if (song.isPreview) {
                song.row.classList.add('preview');
                row.file.classList.add('dl');
                row.file.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16">
                    <path d="M4 8 L4 1 L12 1 L12 8 L16 8 L8 16 L0 8"/>
                </svg>`;

                // Clicking the row will play the song.
                row.id.onclick =
                row.artist.onclick =
                row.song.onclick = () => player.playByIndex(player.list.indexOf(song));
                row.file.onclick = () => remote.shell.openExternal(song.file);
            } else song.row.onclick = () => player.playByIndex(player.list.indexOf(song));

            // Add song info to the table row.
            for (const td in row) song.row.appendChild(row[td]);

            // Add the table row to the table.
            newBody.appendChild(song.row);

            // Save table row for later use.
            // song.row = song.tr;
        }

        table.replaceChild(newBody, table.childNodes[0]);
    }

    function scrollToCurrent() {
        player.current.row.scrollIntoView({
            behavior: 'smooth', block: 'center'
        });
    }
})
