import { supabase } from '../../lib/supabase.js';
import { notifyEventStartingSoon } from '../../lib/notification-service.js';

// Send event reminders (runs every hour)
export default async function handler(req, res) {
  // Verify this is a Vercel cron request
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('⏰ Checking for event reminders...');

  try {
    const results = await sendEventReminders();
    
    console.log(`✅ Event reminder check complete: ${results.remindersSent} reminders sent`);
    
    return res.status(200).json({
      success: true,
      results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error sending event reminders:', error);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

async function sendEventReminders() {
  const results = {
    remindersSent: 0,
    eventsChecked: 0,
    errors: 0
  };

  try {
    const now = new Date();
    
    // Check for events starting in 1 hour (±5 minutes window)
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    const startWindow = new Date(oneHourFromNow.getTime() - 5 * 60 * 1000); // 5 minutes before
    const endWindow = new Date(oneHourFromNow.getTime() + 5 * 60 * 1000);   // 5 minutes after

    // Find events that need 1-hour reminders
    const { data: upcomingEvents, error: eventsError } = await supabase
      .from('events')
      .select('id, name, start_time, organizer_id')
      .gte('start_time', startWindow.toISOString())
      .lte('start_time', endWindow.toISOString())
      .in('status', ['upcoming', 'confirmed']);

    if (eventsError) {
      console.error('Error fetching upcoming events:', eventsError);
      throw eventsError;
    }

    if (!upcomingEvents || upcomingEvents.length === 0) {
      console.log('No events need 1-hour reminders');
      
      // Also check for events starting in 15 minutes
      const fifteenMinutesFromNow = new Date(now.getTime() + 15 * 60 * 1000);
      const startWindow15 = new Date(fifteenMinutesFromNow.getTime() - 2 * 60 * 1000); // 2 minutes before
      const endWindow15 = new Date(fifteenMinutesFromNow.getTime() + 2 * 60 * 1000);   // 2 minutes after

      const { data: soonEvents, error: soonError } = await supabase
        .from('events')
        .select('id, name, start_time, organizer_id')
        .gte('start_time', startWindow15.toISOString())
        .lte('start_time', endWindow15.toISOString())
        .in('status', ['upcoming', 'confirmed']);

      if (soonError) {
        console.error('Error fetching soon events:', soonError);
        return results;
      }

      if (soonEvents && soonEvents.length > 0) {
        results.eventsChecked = soonEvents.length;
        
        for (const event of soonEvents) {
          try {
            await sendEventStartingNotification(event, 15);
            results.remindersSent++;
          } catch (error) {
            console.error(`Error sending 15-minute reminder for event ${event.id}:`, error);
            results.errors++;
          }
        }
      }

      return results;
    }

    results.eventsChecked = upcomingEvents.length;
    console.log(`Found ${upcomingEvents.length} events needing 1-hour reminders`);

    // Send 1-hour reminders
    for (const event of upcomingEvents) {
      try {
        await sendEventStartingNotification(event, 60);
        results.remindersSent++;
      } catch (error) {
        console.error(`Error sending 1-hour reminder for event ${event.id}:`, error);
        results.errors++;
      }
    }

    return results;

  } catch (error) {
    console.error('Error in sendEventReminders:', error);
    throw error;
  }
}

async function sendEventStartingNotification(event, minutesUntil) {
  try {
    // Check if we've already sent this reminder
    const { data: existingReminder, error: reminderCheckError } = await supabase
      .from('notification_history')
      .select('id')
      .eq('event_id', event.id)
      .eq('notification_type', 'event_starting')
      .gte('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()) // Last 2 hours
      .like('data', `%"minutesUntilStart":${minutesUntil}%`)
      .limit(1);

    if (reminderCheckError) {
      console.error('Error checking existing reminders:', reminderCheckError);
    } else if (existingReminder && existingReminder.length > 0) {
      console.log(`⏭️ Already sent ${minutesUntil}-minute reminder for event ${event.id}`);
      return;
    }

    // Get event participants who want reminders
    const { data: participants, error: participantsError } = await supabase
      .from('event_participants')
      .select(`
        user_id,
        users!inner(id),
        notification_preferences!inner(event_updates)
      `)
      .eq('event_id', event.id)
      .eq('status', 'accepted')
      .eq('notification_preferences.event_updates', true);

    if (participantsError) {
      console.error('Error fetching event participants:', participantsError);
      throw participantsError;
    }

    if (!participants || participants.length === 0) {
      console.log(`No participants with notifications enabled for event ${event.id}`);
      return;
    }

    const userIds = participants.map(p => p.user_id);
    console.log(`📨 Sending ${minutesUntil}-minute reminder to ${userIds.length} participants for event "${event.name}"`);

    // Send the notification
    const result = await notifyEventStartingSoon(
      userIds,
      event.id,
      event.name,
      minutesUntil
    );

    if (result.success) {
      console.log(`✅ Sent ${minutesUntil}-minute reminder for event "${event.name}" to ${result.successful} users`);
    } else {
      console.error(`❌ Failed to send ${minutesUntil}-minute reminder for event "${event.name}":`, result.error);
    }

  } catch (error) {
    console.error(`Error sending event starting notification for event ${event.id}:`, error);
    throw error;
  }
}

// Helper function to send custom reminders (can be called manually)
export async function sendCustomReminder(eventId, hoursBeforeStart) {
  try {
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, name, start_time, organizer_id')
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      throw new Error(`Event ${eventId} not found`);
    }

    const eventStartTime = new Date(event.start_time);
    const reminderTime = new Date(eventStartTime.getTime() - hoursBeforeStart * 60 * 60 * 1000);
    const now = new Date();

    // Only send if the reminder time is close to now (within 30 minutes)
    const timeDiff = Math.abs(now.getTime() - reminderTime.getTime()) / (1000 * 60);
    if (timeDiff > 30) {
      throw new Error(`Reminder time is not close enough to current time (${timeDiff.toFixed(1)} minutes difference)`);
    }

    await sendEventStartingNotification(event, hoursBeforeStart * 60);
    return { success: true };

  } catch (error) {
    console.error('Error sending custom reminder:', error);
    throw error;
  }
}