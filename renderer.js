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

class Player extends Emitter {
    constructor(element) {
        super();
        this.audioInit(element);
        this.songRoot = path.join(app.getPath('home'), 'AppData', 'Local', 'osu!', 'Songs');
        this.isOsu = true;
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
        this.isOsu = this.songRoot.indexOf(path.join('osu!', 'Songs')) == this.songRoot.length - 10;
        tasks.push(this.readDir(this.songRoot));
        Promise.all(tasks).then(() => this.emit('ready')).catch(err => this.emit('error', err));
    }

    readDir(dir) {
        const player = this
        return new Promise((resolve, reject) => fs.readdir(dir, (err, res) => {
            const subPromList = [];
            if (err) reject(err);
            else for (const item of res) switch (item.substring(item.length - item.split('').reverse().join('').indexOf('.') - 1).toLowerCase()) {
                case '':
                    subPromList.push(player.readDir(path.join(dir, item)));
                    break;
                case '.mp3':
                    player.list.push(path.join(dir, item).substring(player.songRoot.length + 1));
                    break;
            }
            Promise.all(subPromList).then(resolve);
        }));
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
        this.emit('shuffle');
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
        this.audio.src = path.join(this.songRoot, this.current);
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
        songRows = {};
        player = new Player(document.getElementById('audio'));

    player.on('shuffle', updateTable);
    player.on('ready', updateTable);
    player.on('timeUpdate', () => win.setProgressBar(player.prog, {
        mode: player.audio.paused ? 'paused' : 'normal'
    }));
    player.on('title', isSong => {
        if (isSong && player.current) {
            if (player.isOsu) {
                title.innerHTML = songRows[player.current].childNodes[2].innerText;
                setActivity({
                    details: songRows[player.current].childNodes[1].innerText,
                    state: songRows[player.current].childNodes[2].innerText,
                    largeImageText: 'Mapset ID: ' + songRows[player.current].childNodes[0].innerText,
                    smallImageText: songRows[player.current].childNodes[3].innerText,
                    partySize:  player.list.indexOf(player.current) + 1 ,
                    partyMax: player.list.length,
                });
            } else {
                let help = songRows[player.current].childNodes[0].innerText.split('\\');
                help = help[help.length - 1];
                title.innerHTML = help;
                setActivity({ details: help });
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
            songRows[old].style.cssText = '';
            songRows[old].classList.remove('current');
            songRows[old].classList.remove('expand');
        }
        if (current) {
            const currentRow = songRows[current];
            currentRow.classList.add('current');
            currButt.innerHTML =
                `Track ${ player.list.indexOf(current) + 1 } / ${ player.list.length }`;
            // Change track number & bg image.
            if (player.isOsu) {
                const imgUrl = `https://assets.ppy.sh/beatmaps/${
                    currentRow.childNodes[0].innerText
                }/covers/cover.jpg`;

                fetch(imgUrl).then(res => {
                    if (res.status == 200) {
                        currentRow.classList.add('expand');
                        currentRow.style.cssText =
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
            const row = {};

            if (player.isOsu) {
                row.id = document.createElement('td');
                row.artist = document.createElement('td');
                row.song = document.createElement('td');
                row.file = document.createElement('td');

                let help = song.split('');
                // Extract numbers from the beginning to id td.
                while(!isNaN(help[1])) row.id.innerText += help.shift();
                // Remove empty space from the beginning.
                help[0] = help[0].replace(' ', '').replace('_', '');
                // Extract filename from the end to file td.
                help = help.join('').split('\\');
                row.file.innerText = help.pop();
                // Extract artist and song name from the rest of the string.
                // They should be separated by " - ".
                help = help.join(' ').split(' - ');
                row.song.innerText = help.pop();
                row.artist.innerText = help.pop();
                // Underscore double check.
                if (row.artist.innerText === 'undefined') {
                    help = row.song.innerText.split('_-_');
                    row.song.innerText = help.pop();
                    row.artist.innerText = help.pop();
                }
                row.id.classList.add('numbers');
            } else {
                row.file = document.createElement('td');
                row.file.innerHTML = song;
            }

            // Add classes.
            row.file.classList.add('filename');

            // Create a table row for the song.
            const tr = document.createElement('tr');
            // Clicking the row will play the song.
            tr.onclick = () => player.playByIndex(player.list.indexOf(song));

            // Add song info to the table row.
            for (const td in row) tr.appendChild(row[td]);

            // Add the table row to the table.
            newBody.appendChild(tr);

            // Save table row for later use.
            songRows[song] = tr;
        }

        table.replaceChild(newBody, table.childNodes[0]);

        hideOsuOnlyClass(!player.isOsu);
    }

    function scrollToCurrent() {
        songRows[player.current].scrollIntoView({
            behavior: 'smooth', block: 'center'
        });
    }

    function hideOsuOnlyClass(hide = true) {
        for (const element of osuOnly) element.hidden = hide;
    }
})
