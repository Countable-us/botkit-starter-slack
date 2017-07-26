/*

WHAT IS THIS?

This module demonstrates simple uses of Botkit's `hears` handler functions.

In these examples, Botkit is configured to listen for certain phrases, and then
respond immediately with a single line response.

*/

const axios = require('axios')

const { promisify } = require('util')

const findTrackerUserId = async (username) => {
  let response = await axios({
    url: 'https://www.pivotaltracker.com/services/v5/projects/1410724/memberships',
    method: 'get',
    headers: {
      'X-TrackerToken': process.env.PIVOTAL_TOKEN
    }
  })
  try {
    return response.data.find( membership => membership.person.username == username ).person.id
  }
  catch (e) {
    return nil
  }

}

const createPivotalTrackerStory= async (data) => {
  //curl -X GET -H "X-TrackerToken: $TOKEN" "https://www.pivotaltracker.com/services/v5/projects/$PROJECT_ID/stories"
  const shortTitle = 'Investigate: ' + data.text.slice(0,80) + '…'
  let storyData = {
    current_state: "started",
    story_type: "chore",
    name: shortTitle,
    description: data.text,
    owner_ids: data.owner_ids,
  }

  try {
    let response = await axios({
      url: 'https://www.pivotaltracker.com/services/v5/projects/1410724/stories',
      method: 'post',
      data: storyData,
      headers: {
        'X-TrackerToken': process.env.PIVOTAL_TOKEN
      }
    })
    return response.data
  } catch (e) {
    console.log(e)
  }
}

var wordfilter = require('wordfilter');

module.exports = function(controller) {

    /* Collect some very simple runtime stats for use in the uptime/debug command */
    var stats = {
        triggers: 0,
        convos: 0,
    }

    controller.on('heard_trigger', function() {
        stats.triggers++;
    });

    controller.on('conversationStarted', function() {
        stats.convos++;
    });


    controller.hears(['^uptime','^debug'], 'direct_message,direct_mention', function(bot, message) {

        bot.createConversation(message, function(err, convo) {
            if (!err) {
                convo.setVar('uptime', formatUptime(process.uptime()));
                convo.setVar('convos', stats.convos);
                convo.setVar('triggers', stats.triggers);

                convo.say('My main process has been online for {{vars.uptime}}. Since booting, I have heard {{vars.triggers}} triggers, and conducted {{vars.convos}} conversations.');
                convo.activate();
            }
        });

    });

  controller.hears(["looking into this"], 'ambient,direct_mention,mention', async function(bot, message) {
    console.log(message)
    if (message.thread_ts) {
      let response
      const slackLink = `https://countable.slack.com/archives/${message.channel}/p${message.thread_ts.replace('.', '')}`
      try {
        response = await promisify(bot.api.channels.replies.bind(bot.api.channels))({
          token: bot.config.bot.app_token,
          thread_ts: message.thread_ts,
          channel: message.channel})
      } catch (e) {
        response = await promisify(bot.api.groups.replies.bind(bot.api.channels))({
          token: bot.config.bot.app_token,
          thread_ts: message.thread_ts,
          channel: message.channel})
      }

      const originalMessage = response.messages[0]
      const convo = await promisify(bot.createConversation.bind(bot))(message)
      const userResponse = await promisify(bot.api.users.profile.get.bind(bot.api.users.profile.get))({
        token: bot.config.bot.app_token,
        user: originalMessage.user,
        include_labels: true
      })
      const pivotalUsernameField = Object.keys(userResponse.profile.fields).find( field => {
        let fieldData = userResponse.profile.fields[field]
        return fieldData.label == 'Pivotal Username'
      })
      const pivotalUsername = pivotalUsernameField && userResponse.profile.fields[pivotalUsernameField].value
      const slackUsername = userResponse.profile.real_name

      let existingThread = await promisify(controller.storage.threads.get.bind(controller.storage.threads))(message.thread_ts)
      if (!existingThread) {
        let storyData = {
          text: originalMessage.text + "\n" + slackLink
        }

        let pivotalUserId = await findTrackerUserId(pivotalUsername)
        if (pivotalUserId) {
          storyData.owner_ids = [pivotalUserId]
        }
        const story = await createPivotalTrackerStory(storyData)
        let newThreadStory = {
          id: message.thread_ts,
          story: story.id
        }
        await promisify(controller.storage.threads.save.bind(controller.storage.threads.save))(newThreadStory)
        convo.say(`Created and started a story at https://www.pivotaltracker.com/story/show/${story.id}`)
      } else {
        convo.say(`Story exists at https://www.pivotaltracker.com/story/show/${existingThread.story}`)
      }
      convo.activate()

    }
  })

    controller.hears(['^say (.*)','^say'], 'direct_message,direct_mention', function(bot, message) {
        if (message.match[1]) {

            if (!wordfilter.blacklisted(message.match[1])) {
                bot.reply(message, message.match[1]);
            } else {
                bot.reply(message, '_sigh_');
            }
        } else {
            bot.reply(message, 'I will repeat whatever you say.')
        }
    });


    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* Utility function to format uptime */
    function formatUptime(uptime) {
        var unit = 'second';
        if (uptime > 60) {
            uptime = uptime / 60;
            unit = 'minute';
        }
        if (uptime > 60) {
            uptime = uptime / 60;
            unit = 'hour';
        }
        if (uptime != 1) {
            unit = unit + 's';
        }

        uptime = parseInt(uptime) + ' ' + unit;
        return uptime;
    }

};
