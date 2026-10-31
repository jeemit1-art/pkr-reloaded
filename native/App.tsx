import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {
  ActivityIndicator,AppState,Alert,Platform,Pressable,RefreshControl,ScrollView,
  Share,StatusBar,StyleSheet,Text,TextInput,View
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import {
  type Room,type Player,type Game,type RsvpBoard,type JoinRequest,
  getSession,clearSession,redeemTransferCode,getMe,getRooms,getGames,getRsvp,
  saveRsvp,getJoinRequests,decideJoin,inviteMember,registerNative,
  unregisterNative,testNative,nativeOptInKey,nativeRsvpKey
} from './src/api';

const GOLD='#eac37b',BG='#0b1113',PANEL='#182323',INK='#f5f1e7',MUTED='#a5b5ae';
const PROJECT_ID=process.env.EXPO_PUBLIC_EAS_PROJECT_ID||'';
type Screen='home'|'approvals'|'alerts';

Notifications.setNotificationHandler({
  handleNotification:async()=>({
    shouldShowBanner:true,shouldShowList:true,shouldPlaySound:true,shouldSetBadge:true
  })
});
function dateTime(epoch:number){
  return new Intl.DateTimeFormat('en-AU',{
    weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'
  }).format(new Date(epoch*1000));
}
function Btn({text,onPress,secondary=false,disabled=false}:{
  text:string;onPress:()=>void;secondary?:boolean;disabled?:boolean
}){
  return <Pressable accessibilityRole="button" accessibilityState={{disabled}}
    disabled={disabled} onPress={onPress}
    style={({pressed})=>[
      styles.button,secondary?styles.buttonOutline:styles.buttonGold,
      disabled?styles.disabled:null,pressed?styles.pressed:null
    ]}>
    <Text style={[styles.buttonText,secondary?styles.buttonTextLight:null]}>{text}</Text>
  </Pressable>;
}
function Choice({text,selected,onPress}:{
  text:string;selected:boolean;onPress:()=>void
}){
  return <Pressable accessibilityRole="button" accessibilityState={{selected}}
    onPress={onPress} style={[styles.choice,selected?styles.choiceSelected:null]}>
    <Text style={[styles.choiceText,selected?styles.choiceTextSelected:null]}>{text}</Text>
  </Pressable>;
}
function Card({title,children}:React.PropsWithChildren<{title:string}>){
  return <View style={styles.card}><Text style={styles.cardHeading}>{title}</Text>{children}</View>;
}

export default function App(){
  const [ready,setReady]=useState(false);
  const [signedIn,setSignedIn]=useState(false);
  const [transfer,setTransfer]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [me,setMe]=useState<Player|null>(null);
  const [rooms,setRooms]=useState<Room[]>([]);
  const [selected,setSelected]=useState('');
  const [screen,setScreen]=useState<Screen>('home');
  const [games,setGames]=useState<Game[]>([]);
  const [board,setBoard]=useState<RsvpBoard|null>(null);
  const [requests,setRequests]=useState<JoinRequest[]>([]);
  const [choice,setChoice]=useState('');
  const [seat,setSeat]=useState<number|null>(null);
  const [hasRsvpKey,setHasRsvpKey]=useState(false);
  const [pushToken,setPushToken]=useState('');
  const [alertsOn,setAlertsOn]=useState(false);
  const [inviteName,setInviteName]=useState('');
  const [invitePhone,setInvitePhone]=useState('');
  const [refreshing,setRefreshing]=useState(false);

  const room=rooms.find(r=>r.id===selected);
  const isHost=room?.role==='host';
  const gamesSorted=useMemo(()=>[...games].sort((a,b)=>{
    if(a.status==='active'&&b.status!=='active')return -1;
    if(b.status==='active'&&a.status!=='active')return 1;
    return a.scheduled_at-b.scheduled_at;
  }),[games]);
  const game=gamesSorted.find(g=>['scheduled','lobby','active'].includes(g.status));
  const settled=gamesSorted.filter(g=>g.status==='settled').sort((a,b)=>b.scheduled_at-a.scheduled_at);
  const myRsvp=board?.guests.find(g=>
    g.display_name.trim().toLocaleLowerCase()===me?.name.trim().toLocaleLowerCase());
  const takenSeats=useMemo(()=>{
    if(!board)return new Set<number>();
    return new Set<number>([
      ...board.players.map(p=>p.seat_number),
      ...board.guests.filter(g=>g.status==='yes'&&g.id!==myRsvp?.id)
        .map(g=>g.seat_number).filter((n):n is number=>n!==null)
    ]);
  },[board,myRsvp?.id]);

  const loadAccount=useCallback(async()=>{
    const token=await getSession();
    if(!token){setSignedIn(false);setReady(true);return;}
    try{
      const [person,list]=await Promise.all([getMe(),getRooms()]);
      setMe(person);setRooms(list.filter(x=>x.status!=='ended'));
      setSelected(old=>list.some(r=>r.id===old)?old:list.find(r=>r.status!=='ended')?.id||'');
      setSignedIn(true);setMessage('');
    }catch(e:any){setMessage(e?.message||'Cannot load your rooms.');}
    finally{setReady(true);}
  },[]);

  useEffect(()=>{
    void loadAccount();
    const handler=Notifications.addNotificationResponseReceivedListener(response=>{
      const data=response.notification.request.content.data;
      const eventId=typeof data?.eventId==='string'?data.eventId:'';
      if(eventId)setSelected(eventId);
      setScreen('home');
    });
    const listener=AppState.addEventListener('change',state=>{
      if(state==='active')void loadAccount();
    });
    return()=>{handler.remove();listener.remove();};
  },[loadAccount]);

  const loadRoom=useCallback(async(id:string,quiet=false)=>{
    if(!id)return;
    if(!quiet)setBusy(true);
    try{
      const list=await getGames(id);
      setGames(list);
      const next=[...list].sort((a,b)=>{
        if(a.status==='active'&&b.status!=='active')return -1;
        if(b.status==='active'&&a.status!=='active')return 1;
        return a.scheduled_at-b.scheduled_at;
      }).find(g=>['scheduled','lobby','active'].includes(g.status));
      const b=next&&['scheduled','lobby'].includes(next.status)?
        await getRsvp(next.id).catch(()=>null):null;
      setBoard(b);
      if(b&&next){
        const token=await SecureStore.getItemAsync(nativeRsvpKey(next.id));
        setHasRsvpKey(!!token);
        const self=b.guests.find(g=>
          g.display_name.trim().toLocaleLowerCase()===me?.name.trim().toLocaleLowerCase());
        setChoice(self?.arrival_option||'');
        setSeat(self?.seat_number||null);
      }else{setChoice('');setSeat(null);setHasRsvpKey(false);}
      const selectedRoom=rooms.find(r=>r.id===id);
      if(selectedRoom?.role==='host'){
        const pending=await getJoinRequests(id).catch(()=>({requests:[] as JoinRequest[]}));
        setRequests(pending.requests);
      }else setRequests([]);
      setAlertsOn((await SecureStore.getItemAsync(nativeOptInKey(id)))==='on');
      setMessage('');
    }catch(e:any){setMessage(e?.message||'Room details unavailable.');setGames([]);setBoard(null);}
    finally{if(!quiet)setBusy(false);}
  },[me?.name,rooms]);

  useEffect(()=>{
    if(!selected||!me)return;
    void loadRoom(selected);
    const interval=setInterval(()=>{
      if(AppState.currentState==='active')void loadRoom(selected,true);
    },30000);
    return()=>clearInterval(interval);
  },[selected,me?.id,loadRoom]);

  const restoreNotifications=useCallback(async(id:string)=>{
    if(!id||!PROJECT_ID||!signedIn)return;
    const preferred=await SecureStore.getItemAsync(nativeOptInKey(id));
    if(preferred!=='on')return;
    const permission=await Notifications.getPermissionsAsync();
    if(!permission.granted)return;
    const token=(await Notifications.getExpoPushTokenAsync({projectId:PROJECT_ID})).data;
    if(token){
      await registerNative(id,token,Platform.OS==='ios'?'ios':'android');
      setPushToken(token);
      await SecureStore.setItemAsync('pkr_native_device_token',token);
    }
  },[signedIn]);

  useEffect(()=>{
    if(!selected||!signedIn)return;
    void restoreNotifications(selected).catch(()=>{});
  },[selected,signedIn,restoreNotifications]);

  async function redeem(){
    if(busy)return;
    setBusy(true);setMessage('');
    try{await redeemTransferCode(transfer);setTransfer('');await loadAccount();}
    catch(e:any){setMessage(e?.message||'Cannot restore access.');}
    finally{setBusy(false);}
  }

  async function saveResponse(){
    if(!game||!board||!me||!choice)return;
    setBusy(true);setMessage('');
    try{
      const saved=await SecureStore.getItemAsync(nativeRsvpKey(game.id));
      if(myRsvp&&!saved)throw new Error(
        'An RSVP with your name exists in a different browser. To avoid duplicate responses, change it there or contact the host.'
      );
      const result=await saveRsvp(game.id,{
        display_name:me.name,arrival_option:choice,
        seat_number:choice==='not-coming'?null:seat,
        ...(saved?{edit_token:saved}:{})
      });
      if(result.edit_token)await SecureStore.setItemAsync(nativeRsvpKey(game.id),result.edit_token);
      await loadRoom(selected,true);
      setMessage('RSVP saved. Your host can see the update.');
    }catch(e:any){setMessage(e?.message||'Could not save your RSVP.');}
    finally{setBusy(false);}
  }
  async function decide(request:JoinRequest,approve:boolean){
    if(busy)return;
    setBusy(true);setMessage('');
    try{
      await decideJoin(selected,request.id,approve);
      await loadRoom(selected,true);
      setMessage(approve?
        request.name+' approved. They can return to their WhatsApp invitation to finish joining.':
        request.name+' declined.');
    }catch(e:any){setMessage(e?.message||'Could not update request.');}
    finally{setBusy(false);}
  }
  async function invite(){
    if(!room||!inviteName.trim()||!invitePhone.trim())return;
    setBusy(true);setMessage('');
    try{
      const result=await inviteMember(room.id,inviteName.trim(),invitePhone.trim());
      setInviteName('');setInvitePhone('');
      await Share.share({message:'Join my PKR poker room: '+result.whatsapp_url});
      setMessage('Personal invitation created. Send it privately using WhatsApp.');
    }catch(e:any){setMessage(e?.message||'Could not create invitation.');}
    finally{setBusy(false);}
  }
  async function enableAlerts(){
    if(!selected)return;
    setBusy(true);setMessage('');
    try{
      if(!PROJECT_ID)throw new Error(
        'Native notifications require an EAS project and signed app. Complete the App Store setup first.'
      );
      if(Platform.OS==='android')await Notifications.setNotificationChannelAsync('pkr-game-updates',{
        name:'Poker night & payments',
        importance:Notifications.AndroidImportance.HIGH,
        vibrationPattern:[0,250,100,250,100,250],sound:'default'
      });
      let permission=await Notifications.getPermissionsAsync();
      if(!permission.granted)permission=await Notifications.requestPermissionsAsync();
      if(!permission.granted)throw new Error(
        'Notifications were not allowed. Enable PKR alerts in your phone settings.'
      );
      const token=(await Notifications.getExpoPushTokenAsync({projectId:PROJECT_ID})).data;
      await registerNative(selected,token,Platform.OS==='ios'?'ios':'android');
      await SecureStore.setItemAsync(nativeOptInKey(selected),'on');
      await SecureStore.setItemAsync('pkr_native_device_token',token);
      setPushToken(token);setAlertsOn(true);
      setMessage('Native notifications registered for '+room?.name+'. Run a real test below.');
    }catch(e:any){setMessage(e?.message||'Could not enable native notifications.');}
    finally{setBusy(false);}
  }
  async function disableAlerts(){
    setBusy(true);setMessage('');
    try{
      const token=pushToken||await SecureStore.getItemAsync('pkr_native_device_token');
      if(token)await unregisterNative(selected,token);
      await SecureStore.setItemAsync(nativeOptInKey(selected),'off');
      setAlertsOn(false);setMessage('Notifications disabled for this room.');
    }catch(e:any){setMessage(e?.message||'Could not disable notifications.');}
    finally{setBusy(false);}
  }
  async function testAlert(){
    const token=pushToken||await SecureStore.getItemAsync('pkr_native_device_token');
    if(!token){setMessage('Enable notifications first.');return;}
    setBusy(true);setMessage('');
    try{
      const result=await testNative(selected,token);
      setMessage(result.accepted
        ?'Test accepted by the push service. Check your phone: delivery and sound depend on its settings.'
        :'The push service did not accept the test.');
    }catch(e:any){setMessage(e?.message||'Could not send a test.');}
    finally{setBusy(false);}
  }
  async function signOut(){
    setBusy(true);
    try{
      const token=pushToken||await SecureStore.getItemAsync('pkr_native_device_token');
      if(token)for(const r of rooms){
        await unregisterNative(r.id,token).catch(()=>{});
        await SecureStore.deleteItemAsync(nativeOptInKey(r.id));
      }
      await clearSession();
      setSignedIn(false);setMe(null);setRooms([]);setSelected('');setMessage('');
    }finally{setBusy(false);}
  }
  async function shareRoom(){
    if(!room)return;
    await Share.share({message:'Already approved in '+room.name+
      '? Open your private PKR Instant page — no installation needed: '+
      'https://mypkr.app/instant?room='+encodeURIComponent(room.id)});
  }
  const refresh=()=>{setRefreshing(true);void loadRoom(selected,true).finally(()=>setRefreshing(false));};

  return <View style={styles.page}>
    <StatusBar barStyle="light-content" backgroundColor={BG}/>
    <View style={styles.header}>
      <Text style={styles.brand}><Text style={styles.spade}>♠</Text> PKR</Text>
      <Text style={styles.headerRight}>NATIVE · PRIVATE GROUPS</Text>
    </View>
    {!ready?<View style={styles.loading}>
      <ActivityIndicator size="large" color={GOLD}/><Text style={styles.muted}>Opening PKR…</Text>
    </View>:
    !signedIn?<ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.kicker}>ONE-TIME APPROVED LOGIN</Text>
      <Text style={styles.headline}>Welcome to poker night.</Text>
      <Card title="Restore your approved PKR account">
        <Text style={styles.muted}>If you already joined from WhatsApp, open
          mypkr.app/install in that browser. Tap Generate transfer code,
          then enter the private 16-character code below. Your host does not
          need to approve you again.</Text>
        <TextInput style={styles.field} value={transfer} onChangeText={setTransfer}
          autoCapitalize="characters" autoCorrect={false} accessibilityLabel="Transfer code"
          placeholder="XXXX XXXX XXXX XXXX" placeholderTextColor="#778982" maxLength={23}/>
        <Btn text={busy?'Checking…':'Restore access →'} disabled={busy} onPress={()=>void redeem()}/>
      </Card>
      <Card title="New member?">
        <Text style={styles.muted}>Your host sends a personal WhatsApp invitation.
          You can join immediately in the browser without installing an app.
          Install this native app only if you want it on your phone.</Text>
      </Card>
      {!!message&&<Text accessibilityRole="alert" style={styles.message}>{message}</Text>}
    </ScrollView>:
    <ScrollView contentContainerStyle={styles.body}
      refreshControl={<RefreshControl tintColor={GOLD} refreshing={refreshing} onRefresh={refresh}/>}>
      <Text style={styles.kicker}>YOUR PRIVATE POKER CLUB</Text>
      <Text style={styles.headline}>{screen==='approvals'?'Player approvals':
        screen==='alerts'?'Notification settings':'Poker night, sorted.'}</Text>
      <Text style={styles.muted}>Hello, {me?.name?.split(' ')[0]}. PKR is ready.</Text>
      {rooms.length>1&&<ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={styles.roomTabs} contentContainerStyle={{gap:8}}>
        {rooms.map(r=><Choice key={r.id} text={r.name} selected={r.id===selected}
          onPress={()=>{setSelected(r.id);setScreen('home');}}/>)}
      </ScrollView>}
      {!rooms.length?<Card title="No poker rooms yet">
        <Text style={styles.muted}>Ask your host to send a personal WhatsApp invitation
          and join through the browser. Your approved rooms appear here automatically.</Text>
      </Card>:<>
        <View style={styles.navigation}>
          <Choice text="Games" selected={screen==='home'} onPress={()=>setScreen('home')}/>
          {isHost&&<Choice text={'Approvals'+(requests.length?' · '+requests.length:'')}
            selected={screen==='approvals'} onPress={()=>setScreen('approvals')}/>}
          <Choice text="Alerts" selected={screen==='alerts'} onPress={()=>setScreen('alerts')}/>
        </View>
        {screen==='home'&&<>
          <Card title={room?.name||'Your room'}>
            <Text style={styles.muted}>Private room · {room?.role==='host'?'Host':room?.role==='cohost'?'Co-host':'Member'}</Text>
            <Btn text="Share approved-member link" secondary onPress={()=>void shareRoom()}/>
          </Card>
          {game?<Card title={game.status==='active'?'Game in progress':'Next poker night'}>
            <Text style={styles.gameDate}>{dateTime(game.scheduled_at)}</Text>
            {!!game.location&&<Text style={styles.muted}>{game.location}</Text>}
            <Text style={styles.muted}>Status: {game.status} · {game.seats} seats</Text>
            {game.status==='active'&&<Text style={styles.muted}>
              The full poker table remains in the existing browser app.
            </Text>}
          </Card>:<Card title="No upcoming game">
            <Text style={styles.muted}>Your host hasn't scheduled the next session yet.</Text>
          </Card>}
          {!!board&&!!game&&<Card title="Your RSVP">
            <Text style={styles.muted}>{board.guests.filter(g=>g.status==='yes').length} players coming</Text>
            {myRsvp&&<Text style={styles.help}>Saved: {myRsvp.status==='no'?'Not coming':myRsvp.arrival_option}
              {myRsvp.seat_number?' · Seat '+myRsvp.seat_number:''}</Text>}
            {myRsvp&&!hasRsvpKey?
              <Text style={styles.help}>An RSVP under your name exists elsewhere.
                To edit it, use the original browser or ask your host.</Text>:
              <>
                <View style={styles.choiceRow}>
                  {board.options.map(time=><Choice key={time} text={time}
                    selected={choice===time} onPress={()=>setChoice(time)}/>)}
                  <Choice text="Late" selected={choice==='late'} onPress={()=>setChoice('late')}/>
                  <Choice text="Not coming" selected={choice==='not-coming'} onPress={()=>{
                    setChoice('not-coming');setSeat(null);
                  }}/>
                </View>
                {!!choice&&choice!=='not-coming'&&<View>
                  <Text style={styles.sectionCaption}>Choose an available seat (optional)</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{gap:7,marginBottom:16}}>
                    <Choice text="Any" selected={seat===null} onPress={()=>setSeat(null)}/>
                    {Array.from({length:board.game.seats},(_,i)=>i+1)
                      .filter(n=>!takenSeats.has(n)||n===myRsvp?.seat_number)
                      .map(n=><Choice key={n} text={'Seat '+n} selected={seat===n}
                        onPress={()=>setSeat(n)}/>)}
                  </ScrollView>
                </View>}
                <Btn text={busy?'Saving…':'Save RSVP →'} disabled={busy||!choice}
                  onPress={()=>void saveResponse()}/>
              </>}
          </Card>}
          {!!board&&<Card title="Who's coming">
            {board.guests.length===0?<Text style={styles.muted}>No responses yet.</Text>:
              board.guests.map(g=><View key={g.id} style={styles.playerRow}>
                <Text style={styles.rowName}>{g.display_name}</Text>
                <Text style={styles.rowStatus}>{g.status==='no'?'Not coming':
                  (g.arrival_option==='late'?'Late':g.arrival_option)+
                  (g.seat_number?' · Seat '+g.seat_number:'')}</Text>
              </View>)}
          </Card>}
          {!!settled.length&&<Card title="Latest results">
            {settled.slice(0,3).map(g=><View key={g.id} style={styles.playerRow}>
              <Text style={styles.rowName}>{dateTime(g.scheduled_at)}</Text>
              <Text style={styles.rowStatus}>Settled</Text>
            </View>)}
            <Text style={styles.help}>Detailed results and private payments are
              available in PKR's full browser experience.</Text>
          </Card>}
        </>}
        {screen==='approvals'&&isHost&&<>
          <Card title={'Requests awaiting approval · '+requests.length}>
            {!requests.length?<Text style={styles.muted}>No requests pending.</Text>:
              requests.map(r=><View key={r.id} style={styles.request}>
                <Text style={styles.rowName}>{r.name}</Text>
                <Text style={styles.muted}>Expected: {r.expected_member}</Text>
                <Text style={styles.muted}>Phone: {r.phone}</Text>
                <View style={styles.buttonRow}>
                  <Btn text="Approve" disabled={busy} onPress={()=>void decide(r,true)}/>
                  <Btn text="Decline" secondary disabled={busy} onPress={()=>void decide(r,false)}/>
                </View>
              </View>)}
          </Card>
          <Card title="Invite another player privately">
            <Text style={styles.muted}>Create a personal, one-use link.
              You'll select WhatsApp in the share sheet; nothing sends automatically.</Text>
            <TextInput style={styles.field} value={inviteName} onChangeText={setInviteName}
              accessibilityLabel="Player name" placeholder="Player name" placeholderTextColor="#778982"/>
            <TextInput style={styles.field} value={invitePhone} onChangeText={setInvitePhone}
              accessibilityLabel="Player mobile" placeholder="Mobile number" placeholderTextColor="#778982"
              keyboardType="phone-pad"/>
            <Btn text={busy?'Creating…':'Create WhatsApp invitation →'}
              disabled={busy||inviteName.trim().length<2||invitePhone.trim().length<8}
              onPress={()=>void invite()}/>
          </Card>
        </>}
        {screen==='alerts'&&<Card title="Native game-night alerts">
          <Text style={styles.muted}>Enable notifications once per room. On Android,
            PKR requests a high-importance notification channel. iPhone sound,
            Silent Mode and Focus remain controlled by iOS.</Text>
          <Text style={styles.help}>Room: {room?.name} · {alertsOn?'Alerts selected':'Alerts off'}</Text>
          {alertsOn?
            <Btn text={busy?'Updating…':'Turn alerts off'} disabled={busy} secondary onPress={()=>void disableAlerts()}/>:
            <Btn text={busy?'Updating…':'Enable native alerts'} disabled={busy} onPress={()=>void enableAlerts()}/>}
          {alertsOn&&<Btn text={busy?'Sending…':'Send a real test notification'} secondary
            disabled={busy} onPress={()=>void testAlert()}/>}
          <Text style={styles.help}>A push-service acceptance is not confirmation
            that the phone displayed the notification. On-device testing is required.</Text>
        </Card>}
      </>}
      {!!message&&<Text accessibilityRole="alert" style={styles.message}>{message}</Text>}
      <Btn text="Refresh my rooms" secondary onPress={()=>void loadAccount()}/>
      <Pressable accessibilityRole="button" onPress={()=>Alert.alert('Sign out of PKR?',
        'You can restore access with a new transfer code.',[
          {text:'Cancel',style:'cancel'},{text:'Sign out',style:'destructive',onPress:()=>void signOut()}
        ])}>
        <Text style={styles.signOut}>Sign out</Text>
      </Pressable>
      <Text style={styles.footer}>PKR native preview · private poker management</Text>
    </ScrollView>}
  </View>;
}

const styles=StyleSheet.create({
  page:{flex:1,backgroundColor:BG,paddingTop:Platform.OS==='android'?StatusBar.currentHeight:48},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',
    borderBottomWidth:1,borderBottomColor:'#33413b',paddingVertical:13,paddingHorizontal:18},
  brand:{fontSize:25,fontWeight:'900',color:INK,letterSpacing:1},
  spade:{color:GOLD},
  headerRight:{color:GOLD,fontSize:9,fontWeight:'800',letterSpacing:1.2},
  body:{paddingHorizontal:18,paddingTop:27,paddingBottom:74,gap:14},
  loading:{flex:1,alignItems:'center',justifyContent:'center',gap:16},
  kicker:{fontSize:10,color:GOLD,letterSpacing:2,fontWeight:'800'},
  headline:{fontSize:31,fontWeight:'900',color:INK,letterSpacing:-1},
  muted:{color:MUTED,fontSize:13,lineHeight:20,marginBottom:12},
  card:{backgroundColor:PANEL,borderWidth:1,borderColor:'#3a4941',borderRadius:17,
    padding:18,gap:9,marginBottom:3},
  cardHeading:{fontSize:21,fontWeight:'800',color:INK},
  field:{minHeight:47,borderWidth:1,borderColor:'#5b675a',backgroundColor:'#111e1f',
    color:INK,borderRadius:10,paddingHorizontal:13,fontSize:16},
  button:{borderRadius:10,minHeight:47,paddingHorizontal:13,paddingVertical:12,
    alignItems:'center',justifyContent:'center',marginTop:3},
  buttonGold:{backgroundColor:GOLD},
  buttonOutline:{borderWidth:1,borderColor:'#a18e64',backgroundColor:'#243130'},
  buttonText:{fontSize:13,fontWeight:'800',color:'#132023'},
  buttonTextLight:{color:INK},
  pressed:{opacity:.75},
  disabled:{opacity:.45},
  message:{color:'#f5d5a6',backgroundColor:'#28382a',borderColor:'#b58d54',
    borderWidth:1,padding:13,borderRadius:10,fontSize:13,lineHeight:19},
  roomTabs:{flexGrow:0,maxHeight:60},
  navigation:{flexDirection:'row',flexWrap:'wrap',gap:8,marginVertical:7},
  choiceRow:{flexDirection:'row',flexWrap:'wrap',gap:8,marginVertical:10},
  choice:{borderWidth:1,borderColor:'#5b675a',paddingVertical:12,
    paddingHorizontal:13,borderRadius:10,backgroundColor:'#172625'},
  choiceSelected:{borderColor:GOLD,backgroundColor:'#594b2d'},
  choiceText:{fontSize:12,color:INK,fontWeight:'700'},
  choiceTextSelected:{color:'#ffefc6'},
  gameDate:{fontSize:21,fontWeight:'800',color:GOLD},
  help:{fontSize:12,lineHeight:18,color:'#c3d7ca'},
  sectionCaption:{fontSize:12,color:MUTED,marginBottom:8,fontWeight:'700'},
  playerRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',
    gap:12,paddingVertical:11,borderBottomColor:'#334239',borderBottomWidth:1},
  rowName:{color:INK,fontWeight:'700',fontSize:13,flexShrink:1},
  rowStatus:{color:'#b3d6b7',fontSize:11,flexShrink:1,textAlign:'right'},
  request:{paddingVertical:15,gap:4,borderBottomColor:'#334239',borderBottomWidth:1},
  buttonRow:{flexDirection:'row',gap:10,flexWrap:'wrap',marginTop:10},
  signOut:{fontSize:13,color:'#d8b8ac',textAlign:'center',padding:15},
  footer:{color:'#8a9d95',textAlign:'center',fontSize:11,marginTop:9},
});
