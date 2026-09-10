Component({
 properties:{userId:String,enabled:{type:Boolean,value:true}},data:{opened:false,busy:false},
 methods:{
  open(){if(this.properties.enabled&&this.properties.userId)this.setData({opened:true});},
  close(){if(!this.data.busy)this.setData({opened:false});},noop(){},
  async block(){if(this.data.busy)return;this.setData({busy:true});try{const ok=await require('../../utils/blacklist').blockUser(this.properties.userId);if(ok){this.setData({opened:false});this.triggerEvent('blocked');}}finally{this.setData({busy:false});}},
  report(){if(this.data.busy)return;this.setData({opened:false});require('../../utils/community').report(this.properties.userId);}
 }
});
