## fluxer honeypot :D

### this is extremely bare bones, and also quite aggressive.

this is basically a trap ***account*** (not bot, account) script, specifically for spam users. it sits in your server, and when a spam user dms it, your mod bot bans them from your servers.

it bans whoever dms it if the dm @'s the honeypot (almost every spam user i've seen does this for no reason), or comes from someone who joined your server in the last 30 mins. anything else (normal dms, dms with links, @'s in channels, friend requests) just gets logged, and any links in a dm get pointed out in the log.

it also logs every message it gets, since a normal person wouldn't be messaging it anyway. every dm shows up in your log channel (except from people in ALLOW_IDS), and gets saved to a file called messages.log.

the honeypot is a normal user account being run by a script. fluxer's community guidelines (section 6) don't really say if that's allowed or not. i emailed fluxer support and they said they'd let it slide for my case, but that doesn't mean its ok for everyone. so, ya, run it at your own risk.


### what ya need

node.js 22.13 or newer (check with node --version), a second fluxer account to be the honeypot, and a server where you can manage roles.


***step 1:*** make the mod bot

1. on your main account go to user settings > advanced > developer and turn on developer mode
2. go to user settings > applications > create application and name it whatever
3. under secrets & tokens > bot token, hit regenerate and copy it. (your MOD_BOT_TOKEN)
4. in the oauth2 url builder, tick "bot" and these perms: ban members, view channel, send messages, read message history, manage messages
5. open the link it gives you and add the bot to your server
6. in your server's role settings, drag the bot's role above normal member roles.


***step 2:*** make the honeypot account

1. make a new fluxer account
2. give it a name that shows up at the top of the member list (like starting with ! or A)
3. put something like "automated anti-spam account. don't dm, you could be banned." in its bio
4. add it to your server. don't give it any roles or perms, or at least, the default member ones.
5. to get its token, log into the honeypot in a private window, open devtools (f12), and go to storage > local storage > the fluxer site (on chrome, i genuinely have no idea). copy the token from there. (your HONEYPOT_TOKEN)
6. close the window but don't log out, it'll reset the token.


***step 3:*** grab the ids

with developer mode on you can right click stuff and hit "copy id". you need the id of every server you want protected (GUILD_IDS), a private log channel for the bot (LOG_CHANNEL_ID), and you + your mods + any alts (ALLOW_IDS).


***step 4:*** fill in the settings

copy .env.example to a new file called .env and fill it in:

HONEYPOT_TOKEN - the honeypot's token from step 2\
MOD_BOT_TOKEN - the bot's token from step 1\
GUILD_IDS - server ids, split with commas\
LOG_CHANNEL_ID - the log channel's id\
MODE - "log" only reports stuff, "ban" bans\
ALLOW_IDS - user ids it should never touch, split with commas\
JOIN_WINDOW_MIN - how many mins after joining counts as "new", default is 30\
CONTACT_WINDOW_MIN - how many mins it remembers what someone did (for the notes in the log), default is 10\
INCOMING_REQUEST_TYPE - just leave this as 3 (logs friend requests)


***step 5:*** install and run it

open a terminal (or git bash or something lol) in this folder and run npm install, then npm start. it should say "mod bot online", "honeypot online", and "mode: log/ban".


***step 6:*** test it

while its still on log mode, use an account that's not in ALLOW_IDS and try stuff:

dm it "hi" and the log should say "dm from ... - noted, no action"\
dm it a link and it should say "dm from ... - noted, no action (link: ...)"\
dm it an @ of itself and it should say "WOULD BAN ... @ mentioned the honeypot inside the DM"\
@ it in a channel and it should say "ping from ... - noted, no action"\
send it a friend request and it should say "friend request from ... - noted, no action"

each account only gets one "WOULD BAN" per run (their dms after that show up as "already flagged"), so restart it if you wanna test again.


***step 7:*** turn on banning (optional)

change MODE=log to MODE=ban in .env, stop it with ctrl + c, and run npm start again. it should say "mode: ban". bans show up as "BANNED ..." in the log. if it bans someone by mistake just unban them from your server's ban list.


***errors:***

"missing config: ..." means that setting is empty in .env

if it stops right away, one of the tokens is wrong or expired. if you logged the honeypot out, grab a new token

if nothing shows up in the log channel, the bot needs view channel and send messages in that channel

"BAN FAILED ... Missing Permissions" means the bot needs ban members and its role has to be above normal members. it'll try again on their next dm


keep your tokens private. please.

***credits***

[@fluxerjs/core](https://fluxer.js.org/)\
[fluxer-selfbot](https://github.com/Cleboost/fluxer-selfbot)
