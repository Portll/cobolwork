       IDENTIFICATION DIVISION.
       PROGRAM-ID. MESSAGES.
      * Text about a password, and a flag saying whether it passed.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-PASSWORD-PROMPT  PIC X(27)
                              VALUE "Please enter your password:".
       01 WS-PASSWORD-ERROR   PIC X(40)
                              VALUE "Password must be 8-12 characters".
       01 WS-PASSWORD-VALID   PIC X VALUE "N".
       PROCEDURE DIVISION.
           DISPLAY WS-PASSWORD-PROMPT
           DISPLAY WS-PASSWORD-ERROR
           DISPLAY WS-PASSWORD-VALID
           GOBACK.
