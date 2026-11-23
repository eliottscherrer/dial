# changelog

## 0.1.3

- pitch now has its own slider in advanced options, so you can move it up or down by up to 12 semitones at any speed, 1x included ([#1](https://github.com/eliottscherrer/dial/issues/1)). it can sound a bit muffled because Spotify's engine has to time stretch the song to do it, and the reset button next to it puts the pitch back on the speed
- skipping past the last track of a playlist now lands on its first track like Spotify does, instead of a random track from Dial's queue, and pressing play there keeps your speed
- the reset at the top of the panel is an icon now

## 0.1.2

- fixed the client freezing when you hover a time label while a speed other than 1x is set
- a track you start yourself now plays at the speed from its first moment, instead of starting at 1x and restarting half a second later
- after a restart Dial keeps the playlist the music came from, and the panel shows the speed that is actually playing, so a restored slow queue no longer plays slowly under a panel that says 1x
- changing the speed twice quickly always ends on the last one
- if Spotify stops honoring the speed, Dial gives up after two tries instead of reloading the track in a loop
- pressing reset while already at 1x no longer reloads the song

## 0.1.1

the first release

- a playbar gauge and a panel with a rate slider from 0.5x to 1.5x, three presets you can rename and re-rate, and a lock for the pitch
- real time and song time for the time labels, and hovering one rolls it over to the other
- dragging the gauge itself turns it between your presets
- the extension checks that Spotify still honors the two speed keys and says so in the panel when it doesn't

## it can stop working

Dial depends on a speed setting that Spotify provides, so it can stop working at any time and there's no way to know when. a Spotify version number says nothing about it, because the same version can work one day and not the next
